import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ChatMessage, ChatSession } from '@prisma/client';
import { AiClient } from '../ai-client/ai-client.service.js';
import type { PastChatReference } from '../ai-client/ai-client.types.js';
import { fromDbDate, toDbDate } from '../common/dates.js';
import { AppException } from '../common/errors/app.exception.js';
import { todayKst } from '../common/pipes/parse-date.pipe.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  PRESETS,
  type AvailabilityDto,
  type AvailabilityPresetDto,
  type ChatMessageDto,
  type ChatMessagePageDto,
  type ChatSessionDto,
  type CitationDto,
  type SendMessageResultDto,
} from './past-self.dto.js';
import { presetAnchorDate } from './presets.js';

export const REQUIRED_RECORDS = 7; // prd.md §7-2 ⑨
export const MAX_USER_MESSAGES = 30; // prd.md §7-2 ⑩
const PREVIEW_LENGTH = 80;

// 기억으로 쓰이는 일기: 확정됐고 기억에서 제외되지 않은 것
const memoryWhere = (userId: string) => ({
  userId,
  status: 'CONFIRMED' as const,
  excludedFromMemory: false,
});

const sessionNotFound = () =>
  new AppException(
    'SESSION_NOT_FOUND',
    HttpStatus.NOT_FOUND,
    '대화를 찾을 수 없어요.',
  );

export function assertNotFuture(date: string) {
  if (date > todayKst()) {
    throw new AppException(
      'DATE_IN_FUTURE',
      HttpStatus.UNPROCESSABLE_ENTITY,
      '오늘 이후 날짜는 고를 수 없어요.',
    );
  }
}

// AI가 고른 근거를 서버가 다시 검증한다 (ADR-007 근거 재검증).
// 남의 일기·T 이후·미확정·제외·없는 ID는 버리고, 중복을 없애고, 날짜순으로 정렬한다.
export function filterCitations(
  references: PastChatReference[],
  valid: { id: string; date: string }[],
): CitationDto[] {
  const byId = new Map(valid.map((v) => [v.id, v.date]));
  const seen = new Set<string>();
  const out: CitationDto[] = [];
  for (const ref of references) {
    const date = byId.get(ref.diary_id);
    if (!date || seen.has(ref.diary_id)) continue;
    seen.add(ref.diary_id);
    out.push({ entryId: ref.diary_id, date });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

function toMessageDto(m: ChatMessage): ChatMessageDto {
  const citations = Array.isArray(m.citations)
    ? (m.citations as unknown as CitationDto[])
    : [];
  return {
    id: m.id,
    role: m.role,
    content: m.content,
    citations,
    flag: m.flag,
    createdAt: m.createdAt.toISOString(),
  };
}

function toSessionDto(
  s: ChatSession & { messages: { content: string }[] },
): ChatSessionDto {
  const last = s.messages[0]?.content ?? null;
  return {
    id: s.id,
    anchorDate: fromDbDate(s.anchorDate),
    messageCount: s.messageCount,
    createdAt: s.createdAt.toISOString(),
    lastMessageAt: s.lastMessageAt?.toISOString() ?? null,
    lastMessagePreview:
      last && last.length > PREVIEW_LENGTH
        ? `${last.slice(0, PREVIEW_LENGTH)}…`
        : last,
  };
}

@Injectable()
export class PastSelfService {
  private readonly logger = new Logger(PastSelfService.name);
  private readonly topK: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiClient,
    config: ConfigService,
  ) {
    // 5개면 기록이 많을 때 시점 직전의 핵심 일기를 놓치는 경우가 있었다 (실측). prd.md §7-2 ③도 상위 8건
    this.topK = Number(config.get('PAST_CHAT_TOP_K', 8));
  }

  // H1: 시점 T 이전(당일 포함) 기억 수
  async availability(
    userId: string,
    anchorDate: string,
  ): Promise<AvailabilityDto> {
    assertNotFuture(anchorDate);
    const where = {
      ...memoryWhere(userId),
      entryDate: { lte: toDbDate(anchorDate) },
    };
    const [recordCount, first] = await Promise.all([
      this.prisma.entry.count({ where }),
      this.prisma.entry.findFirst({
        where,
        orderBy: { entryDate: 'asc' },
        select: { entryDate: true },
      }),
    ]);
    return {
      anchorDate,
      available: recordCount >= REQUIRED_RECORDS,
      recordCount,
      firstRecordDate: first ? fromDbDate(first.entryDate) : null,
      requiredCount: REQUIRED_RECORDS,
    };
  }

  // H1 (anchorDate 생략): 프리셋 5개를 한 번의 조회로 계산
  async presets(userId: string): Promise<AvailabilityPresetDto[]> {
    const today = todayKst();
    const dates = (
      await this.prisma.entry.findMany({
        where: memoryWhere(userId),
        select: { entryDate: true },
      })
    ).map((e) => fromDbDate(e.entryDate));

    return PRESETS.map((preset) => {
      const anchorDate = presetAnchorDate(preset, today);
      const recordCount = dates.filter((d) => d <= anchorDate).length;
      return {
        preset,
        anchorDate,
        available: recordCount >= REQUIRED_RECORDS,
        recordCount,
      };
    });
  }

  // H2
  async createSession(
    userId: string,
    anchorDate: string,
  ): Promise<ChatSessionDto> {
    const { recordCount } = await this.availability(userId, anchorDate);
    if (recordCount < REQUIRED_RECORDS) {
      throw new AppException(
        'NOT_ENOUGH_RECORDS',
        HttpStatus.UNPROCESSABLE_ENTITY,
        `이 시점까지 기록이 ${REQUIRED_RECORDS}일 이상 있어야 대화할 수 있어요.`,
        { recordCount, required: REQUIRED_RECORDS },
      );
    }
    const session = await this.prisma.chatSession.create({
      data: { userId, anchorDate: toDbDate(anchorDate) },
    });
    return toSessionDto({ ...session, messages: [] });
  }

  // H3: 최근 대화순 (메시지가 없으면 만든 순)
  async listSessions(userId: string): Promise<ChatSessionDto[]> {
    const sessions = await this.prisma.chatSession.findMany({
      where: { userId },
      orderBy: [
        { lastMessageAt: { sort: 'desc', nulls: 'last' } },
        { createdAt: 'desc' },
      ],
      take: 50,
      include: {
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { content: true },
        },
      },
    });
    return sessions.map(toSessionDto);
  }

  // H4: cursor가 없으면 최근 limit개, 있으면 그 이전 limit개. 응답은 오래된 순
  async messages(
    userId: string,
    sessionId: string,
    cursor: string | undefined,
    limit = 30,
  ): Promise<ChatMessagePageDto> {
    await this.findSession(userId, sessionId);
    const before = cursor
      ? await this.prisma.chatMessage.findFirst({
          where: { id: cursor, sessionId },
          select: { createdAt: true, id: true },
        })
      : null;
    if (cursor && !before) {
      throw new AppException(
        'VALIDATION_FAILED',
        HttpStatus.BAD_REQUEST,
        '커서를 확인해 주세요.',
        [{ field: 'cursor', reasons: ['unknown'] }],
      );
    }

    const rows = await this.prisma.chatMessage.findMany({
      where: {
        sessionId,
        ...(before
          ? {
              OR: [
                { createdAt: { lt: before.createdAt } },
                { createdAt: before.createdAt, id: { lt: before.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit).reverse();
    return {
      items: page.map(toMessageDto),
      nextCursor: hasMore ? page[0].id : null,
    };
  }

  // H5: 과거의 나에게 묻는다. AI가 실패하면 아무것도 저장하지 않는다 (다시 보내도 중복 없음)
  async send(
    userId: string,
    sessionId: string,
    content: string,
  ): Promise<SendMessageResultDto> {
    const session = await this.findSession(userId, sessionId);
    const userCount = await this.prisma.chatMessage.count({
      where: { sessionId, role: 'USER' },
    });
    if (userCount >= MAX_USER_MESSAGES) {
      throw new AppException(
        'SESSION_MESSAGE_LIMIT',
        HttpStatus.UNPROCESSABLE_ENTITY,
        '이 대화는 여기까지예요. 오늘로 돌아와 새 대화를 시작해 주세요.',
        { max: MAX_USER_MESSAGES },
      );
    }

    const anchorDate = fromDbDate(session.anchorDate);
    const started = Date.now();
    const result = await this.ai.pastChat({
      user_id: userId,
      target_date: anchorDate,
      message: content,
      top_k: this.topK,
    });
    const latencyMs = Date.now() - started;

    const referenced = [...new Set(result.references.map((r) => r.diary_id))];
    const valid = await this.prisma.entry.findMany({
      where: {
        ...memoryWhere(userId),
        id: { in: referenced },
        entryDate: { lte: toDbDate(anchorDate) },
      },
      select: { id: true, entryDate: true },
    });
    const citations = filterCitations(
      result.references,
      valid.map((v) => ({ id: v.id, date: fromDbDate(v.entryDate) })),
    );
    if (citations.length < referenced.length) {
      // AI 서버의 시점·소유자 필터가 새고 있다는 신호
      this.logger.warn(
        JSON.stringify({
          event: 'citations_filtered',
          sessionId,
          referenced: referenced.length,
          kept: citations.length,
        }),
      );
    }

    const now = new Date();
    const [userMessage, assistantMessage] = await this.prisma.$transaction(
      async (tx) => {
        const u = await tx.chatMessage.create({
          data: { sessionId, role: 'USER', content, createdAt: now },
        });
        const a = await tx.chatMessage.create({
          data: {
            sessionId,
            role: 'ASSISTANT',
            content: result.answer,
            citations: citations as unknown as object[],
            flag: citations.length === 0 ? 'NO_EVIDENCE' : 'NONE',
            latencyMs,
            createdAt: new Date(now.getTime() + 1),
          },
        });
        await tx.chatSession.update({
          where: { id: sessionId },
          data: { messageCount: { increment: 2 }, lastMessageAt: a.createdAt },
        });
        return [u, a];
      },
    );
    return {
      userMessage: toMessageDto(userMessage),
      assistantMessage: toMessageDto(assistantMessage),
    };
  }

  private async findSession(userId: string, sessionId: string) {
    const session = await this.prisma.chatSession.findFirst({
      where: { id: sessionId, userId },
    });
    if (!session) throw sessionNotFound();
    return session;
  }
}
