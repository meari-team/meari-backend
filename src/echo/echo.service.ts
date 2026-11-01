import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, type Echo, type EchoSetting } from '@prisma/client';
import { AiClient } from '../ai-client/ai-client.service.js';
import { fromDbDate, toDbDate } from '../common/dates.js';
import { AppException } from '../common/errors/app.exception.js';
import { entryNotFound } from '../entries/entries.service.js';
import { REQUIRED_RECORDS } from '../past-self/past-self.service.js';
import type { CitationDto } from '../past-self/past-self.dto.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PhotoStorage } from '../storage/photo-storage.js';
import {
  composeEchoMessage,
  echoPrompt,
  echoPushContent,
  previewOf,
} from './echo-message.js';
import { pickEchoEntry } from './echo-pick.js';
import {
  formatMinute,
  isValidTimezone,
  nextEchoRun,
  parseTime,
} from './echo-schedule.js';
import type {
  EchoDto,
  EchoListDto,
  EchoSettingsDto,
  EchoSummaryDto,
  PushTokenDto,
  UpdateEchoSettingsDto,
} from './echo.dto.js';
import { PushSender } from './push-sender.js';

export type SlotOutcome =
  | { status: 'created'; echoId: string }
  | { status: 'exists' | 'disabled' | 'no_candidate' };

const MAX_PUSH_ATTEMPTS = 3;
const PUSH_RETRY_WINDOW_MS = 6 * 60 * 60 * 1000;
const PUSH_CHANNEL = 'echo';

// 설정 행이 없을 때 (= 처음 쓰는 사람): 미동의, 주 1회 일요일 21:00
const DEFAULT_SETTING = {
  enabled: false,
  frequency: 'WEEKLY' as const,
  weekday: 0,
  monthDay: 1,
  minuteOfDay: 21 * 60,
  timezone: 'Asia/Seoul',
  showPreview: false,
  nextRunAt: null,
};

// 메아리 후보: 북마크한 확정 일기 중 기억에서 제외하지 않은 것 (삭제된 일기는 행이 없다)
const candidateWhere = (userId: string) => ({
  userId,
  status: 'CONFIRMED' as const,
  excludedFromMemory: false,
  bookmarkedAt: { not: null },
});

// 과거의 나 대화에 쓰이는 기억 (past-self.service.ts와 같은 조건)
const memoryWhere = (userId: string) => ({
  userId,
  status: 'CONFIRMED' as const,
  excludedFromMemory: false,
});

const echoNotFound = () =>
  new AppException(
    'ECHO_NOT_FOUND',
    HttpStatus.NOT_FOUND,
    '메아리를 찾을 수 없어요.',
  );

const toSummary = (
  e: Echo & { entry: { entryDate: Date } },
): EchoSummaryDto => ({
  id: e.id,
  entryDate: fromDbDate(e.entry.entryDate),
  sessionId: e.sessionId,
  preview: previewOf(e.message),
  readAt: e.readAt?.toISOString() ?? null,
  createdAt: e.createdAt.toISOString(),
});

@Injectable()
export class EchoService {
  private readonly logger = new Logger(EchoService.name);
  readonly demoAvailable: boolean;

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiClient,
    private readonly storage: PhotoStorage,
    private readonly push: PushSender,
    config: ConfigService,
  ) {
    this.demoAvailable = config.get('ECHO_DEMO', 'false') === 'true';
  }

  // ── 북마크 ────────────────────────────────────────────

  // 확정한 일기만. 해제해도 이미 도착한 메아리·대화는 그대로 둔다
  async setBookmark(
    userId: string,
    date: string,
    bookmarked: boolean,
  ): Promise<void> {
    const entry = await this.prisma.entry.findUnique({
      where: { userId_entryDate: { userId, entryDate: toDbDate(date) } },
      select: { id: true, status: true, bookmarkedAt: true },
    });
    if (!entry) throw entryNotFound();
    if (entry.status !== 'CONFIRMED') {
      throw new AppException(
        'INVALID_ENTRY_STATE',
        HttpStatus.CONFLICT,
        '확정한 일기만 기억하고 싶은 날로 표시할 수 있어요.',
        { status: entry.status },
      );
    }
    if (bookmarked === (entry.bookmarkedAt !== null)) return;
    await this.prisma.entry.update({
      where: { id: entry.id },
      data: { bookmarkedAt: bookmarked ? new Date() : null },
    });
  }

  // ── 설정 ──────────────────────────────────────────────

  async getSettings(userId: string): Promise<EchoSettingsDto> {
    const [setting, candidateCount, tokens] = await Promise.all([
      this.prisma.echoSetting.findUnique({ where: { userId } }),
      this.prisma.entry.count({ where: candidateWhere(userId) }),
      this.prisma.pushToken.count({ where: { userId } }),
    ]);
    const s = setting ?? DEFAULT_SETTING;
    return {
      enabled: s.enabled,
      frequency: s.frequency,
      weekday: s.weekday,
      monthDay: s.monthDay,
      time: formatMinute(s.minuteOfDay),
      timezone: s.timezone,
      showPreview: s.showPreview,
      nextRunAt: s.enabled ? (s.nextRunAt?.toISOString() ?? null) : null,
      candidateCount,
      pushRegistered: tokens > 0,
      demoAvailable: this.demoAvailable,
    };
  }

  // 보낸 필드만 바꾼다. 동의 중이면 다음 회차를 지금 이후로 다시 계산한다
  // (다시 동의해도 미동의 기간의 회차를 몰아서 보내지 않는다). 미동의면 예약을 지우고 주기 값은 보존한다
  async updateSettings(
    userId: string,
    dto: UpdateEchoSettingsDto,
    now = new Date(),
  ): Promise<EchoSettingsDto> {
    if (dto.timezone !== undefined && !isValidTimezone(dto.timezone)) {
      throw new AppException(
        'VALIDATION_FAILED',
        HttpStatus.BAD_REQUEST,
        '시간대를 확인해 주세요.',
        [{ field: 'timezone', reasons: ['invalid'] }],
      );
    }
    const current: Omit<EchoSetting, 'userId' | 'updatedAt'> =
      (await this.prisma.echoSetting.findUnique({ where: { userId } })) ??
      DEFAULT_SETTING;
    const next = {
      enabled: dto.enabled ?? current.enabled,
      frequency: dto.frequency ?? current.frequency,
      weekday: dto.weekday ?? current.weekday,
      monthDay: dto.monthDay ?? current.monthDay,
      minuteOfDay:
        dto.time !== undefined
          ? (parseTime(dto.time) ?? current.minuteOfDay)
          : current.minuteOfDay,
      timezone: dto.timezone ?? current.timezone,
      showPreview: dto.showPreview ?? current.showPreview,
    };
    const nextRunAt = next.enabled ? nextEchoRun(next, now) : null;
    await this.prisma.echoSetting.upsert({
      where: { userId },
      create: { userId, ...next, nextRunAt },
      update: { ...next, nextRunAt },
    });
    return this.getSettings(userId);
  }

  // ── 푸시 토큰 ─────────────────────────────────────────

  // 같은 기기에서 다른 계정으로 로그인하면 토큰 주인을 옮긴다
  async registerToken(userId: string, dto: PushTokenDto): Promise<void> {
    await this.prisma.pushToken.upsert({
      where: { token: dto.token },
      create: { token: dto.token, userId, platform: dto.platform },
      update: { userId, platform: dto.platform },
    });
  }

  async removeToken(userId: string, token: string): Promise<void> {
    await this.prisma.pushToken.deleteMany({ where: { token, userId } });
  }

  // ── 받은 메아리 ───────────────────────────────────────

  async list(userId: string): Promise<EchoListDto> {
    const [rows, unreadCount] = await Promise.all([
      this.prisma.echo.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 50,
        include: { entry: { select: { entryDate: true } } },
      }),
      this.prisma.echo.count({ where: { userId, readAt: null } }),
    ]);
    return { items: rows.map(toSummary), unreadCount };
  }

  // 남의 메아리와 없는 메아리를 구분하지 않는다 (둘 다 404)
  async get(userId: string, id: string): Promise<EchoDto> {
    const echo = await this.prisma.echo.findFirst({
      where: { id, userId },
      include: {
        entry: {
          select: {
            entryDate: true,
            finalContent: true,
            confirmedAt: true,
            photos: { orderBy: { sortOrder: 'asc' } },
          },
        },
      },
    });
    if (!echo) throw echoNotFound();
    const date = fromDbDate(echo.entry.entryDate);
    const recordCount = await this.prisma.entry.count({
      where: {
        ...memoryWhere(userId),
        entryDate: { lte: echo.entry.entryDate },
      },
    });
    const photos = await Promise.all(
      echo.entry.photos.map(async (p) => ({
        id: p.id,
        url: (await this.storage.signedUrl(p.storageKey)) ?? '',
        width: p.width,
        height: p.height,
        caption: p.caption,
        sortOrder: p.sortOrder,
      })),
    );
    return {
      id: echo.id,
      entryDate: date,
      sessionId: echo.sessionId,
      preview: previewOf(echo.message),
      readAt: echo.readAt?.toISOString() ?? null,
      createdAt: echo.createdAt.toISOString(),
      message: echo.message,
      source: echo.source,
      citations: Array.isArray(echo.citations)
        ? (echo.citations as unknown as CitationDto[])
        : [],
      photos,
      finalContent: echo.entry.finalContent,
      entryEdited:
        !!echo.entry.confirmedAt &&
        echo.entry.confirmedAt.getTime() > echo.entryVersion.getTime(),
      chat: {
        available: echo.sessionId !== null,
        recordCount,
        requiredCount: REQUIRED_RECORDS,
      },
    };
  }

  async markRead(userId: string, id: string): Promise<void> {
    const { count } = await this.prisma.echo.updateMany({
      where: { id, userId },
      data: { readAt: new Date() },
    });
    if (count === 0) throw echoNotFound();
  }

  // ── 시연 ──────────────────────────────────────────────

  // 예약을 기다리지 않고 지금 한 회차를 만든다 (ECHO_DEMO=true일 때만). 동의·후보 조건은 실제와 같다
  async demo(userId: string): Promise<EchoDto> {
    const outcome = await this.runSlot(userId, `demo:${Date.now()}`);
    if (outcome.status === 'disabled') {
      throw new AppException(
        'ECHO_DISABLED',
        HttpStatus.CONFLICT,
        '메아리 알림 받기에 먼저 동의해 주세요.',
      );
    }
    if (outcome.status !== 'created') {
      throw new AppException(
        'NO_ECHO_CANDIDATES',
        HttpStatus.UNPROCESSABLE_ENTITY,
        '기억하고 싶은 날을 북마크하면 메아리가 찾아와요.',
      );
    }
    await this.deliver(outcome.echoId);
    return this.get(userId, outcome.echoId);
  }

  // ── 예약 회차 ─────────────────────────────────────────

  // 예약이 된 사용자들의 회차를 처리한다. 회차를 먼저 '내 것'으로 표시해서(조건부 갱신)
  // 같은 회차를 두 번 처리하지 않는다. 놓친 회차는 몰아서 보내지 않고 지금 이후 회차로 넘어간다
  async processDue(now = new Date()): Promise<number> {
    const due = await this.prisma.echoSetting.findMany({
      where: { enabled: true, nextRunAt: { lte: now } },
      orderBy: { nextRunAt: 'asc' },
      take: 100,
    });
    let created = 0;
    for (const s of due) {
      // 아직 이 회차가 지나지 않은 행만 잡는다. 다른 실행이 먼저 잡았으면 nextRunAt이 미래라 0건
      // (같은 값 비교는 DB의 마이크로초와 JS의 밀리초가 달라 놓칠 수 있다)
      const claimed = await this.prisma.echoSetting.updateMany({
        where: { userId: s.userId, enabled: true, nextRunAt: { lte: now } },
        data: { nextRunAt: nextEchoRun(s, now) },
      });
      if (claimed.count !== 1 || !s.nextRunAt) continue;
      try {
        const outcome = await this.runSlot(s.userId, s.nextRunAt.toISOString());
        this.logger.log(
          JSON.stringify({ event: 'echo_slot', userId: s.userId, ...outcome }),
        );
        if (outcome.status === 'created') {
          created++;
          await this.deliver(outcome.echoId);
        }
      } catch (e) {
        this.logger.error(
          JSON.stringify({
            event: 'echo_slot_failed',
            userId: s.userId,
            error: e instanceof Error ? e.message : String(e),
          }),
        );
      }
    }
    return created;
  }

  // 한 회차: 후보 고르기 → 첫 메시지 → (저장 직전 재확인) → 메아리·대화방·첫 메시지 저장.
  // 같은 slotKey는 한 번만 만든다 (유니크 키). 저장까지 끝난 뒤에만 알림을 보낸다
  async runSlot(userId: string, slotKey: string): Promise<SlotOutcome> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const setting = await this.prisma.echoSetting.findUnique({
        where: { userId },
      });
      if (!setting?.enabled) return { status: 'disabled' };
      const existing = await this.prisma.echo.findUnique({
        where: { userId_slotKey: { userId, slotKey } },
        select: { id: true },
      });
      if (existing) return { status: 'exists' };

      const entryId = await this.pickCandidate(userId);
      if (!entryId) return { status: 'no_candidate' };
      const entry = await this.prisma.entry.findUniqueOrThrow({
        where: { id: entryId },
        select: {
          entryDate: true,
          confirmedAt: true,
          _count: { select: { photos: true } },
        },
      });
      const date = fromDbDate(entry.entryDate);
      const composed = composeEchoMessage({
        date,
        entryId,
        hasPhotos: entry._count.photos > 0,
        ai: await this.askPastSelf(userId, date),
      });
      const citations: CitationDto[] = [{ entryId, date }];

      try {
        const result = await this.prisma.$transaction(async (tx) => {
          // 저장 직전에 동의와 후보 상태를 다시 본다
          const fresh = await tx.echoSetting.findUnique({ where: { userId } });
          if (!fresh?.enabled) return 'disabled' as const;
          const still = await tx.entry.findFirst({
            where: { ...candidateWhere(userId), id: entryId },
            select: { confirmedAt: true },
          });
          if (!still) return 'repick' as const;

          // 기존 과거의 나 조건(기준일까지 기록 7일)을 채우면 대화방을 만들고 첫 메시지를 넣는다
          const recordCount = await tx.entry.count({
            where: {
              ...memoryWhere(userId),
              entryDate: { lte: entry.entryDate },
            },
          });
          const now = new Date();
          let sessionId: string | null = null;
          if (recordCount >= REQUIRED_RECORDS) {
            const session = await tx.chatSession.create({
              data: {
                userId,
                anchorDate: entry.entryDate,
                messageCount: 1,
                lastMessageAt: now,
              },
            });
            await tx.chatMessage.create({
              data: {
                sessionId: session.id,
                role: 'ASSISTANT',
                content: composed.message,
                citations: citations as unknown as object[],
                createdAt: now,
              },
            });
            sessionId = session.id;
          }
          return tx.echo.create({
            data: {
              userId,
              entryId,
              slotKey,
              sessionId,
              message: composed.message,
              source: composed.source,
              citations: citations as unknown as object[],
              entryVersion: still.confirmedAt ?? now,
              createdAt: now,
            },
            select: { id: true },
          });
        });
        if (result === 'disabled') return { status: 'disabled' };
        if (result === 'repick') continue;
        return { status: 'created', echoId: result.id };
      } catch (e) {
        if (
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === 'P2002'
        ) {
          return { status: 'exists' };
        }
        throw e;
      }
    }
    return { status: 'no_candidate' };
  }

  private async pickCandidate(userId: string): Promise<string | null> {
    const [candidates, history] = await Promise.all([
      this.prisma.entry.findMany({
        where: candidateWhere(userId),
        select: { id: true },
        orderBy: { entryDate: 'asc' },
      }),
      this.prisma.echo.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        select: { entryId: true },
        take: 500,
      }),
    ]);
    return pickEchoEntry(
      candidates.map((c) => c.id),
      history.map((h) => h.entryId),
    );
  }

  // 과거의 나(기준일 = 그 일기 날짜)에게 그날 이야기를 묻는다. 실패하면 null → 기본 문구
  // 근거는 서버가 다시 거른다 (본인·확정·미제외·기준일 이전)
  private async askPastSelf(userId: string, date: string) {
    try {
      const result = await this.ai.pastChat({
        user_id: userId,
        target_date: date,
        message: echoPrompt(date),
        top_k: 8,
      });
      const ids = [...new Set(result.references.map((r) => r.diary_id))];
      const valid = await this.prisma.entry.findMany({
        where: {
          ...memoryWhere(userId),
          id: { in: ids },
          entryDate: { lte: toDbDate(date) },
        },
        select: { id: true },
      });
      return {
        answer: result.answer,
        citedEntryIds: valid.map((v) => v.id),
      };
    } catch (e) {
      this.logger.warn(
        JSON.stringify({
          event: 'echo_ai_failed',
          error: e instanceof Error ? e.message : String(e),
        }),
      );
      return null;
    }
  }

  // ── 알림 ──────────────────────────────────────────────

  // 메아리는 이미 저장돼 있다. 여기서는 푸시만 보낸다 (재시도해도 메아리를 새로 만들지 않는다)
  async deliver(echoId: string): Promise<void> {
    const echo = await this.prisma.echo.findUnique({
      where: { id: echoId },
      include: {
        entry: { select: { entryDate: true } },
        user: { select: { echoSetting: true, pushTokens: true } },
      },
    });
    if (!echo || echo.pushStatus === 'SENT') return;
    const setting = echo.user.echoSetting;
    // 보내기 직전에 동의를 거뒀으면 이 회차는 알리지 않는다 (앱 안에는 남는다)
    if (!setting?.enabled) {
      await this.setPush(echoId, 'SKIPPED', 'disabled');
      return;
    }
    if (!this.push.available) {
      await this.setPush(echoId, 'SKIPPED', 'push_off');
      return;
    }
    const tokens = echo.user.pushTokens;
    if (tokens.length === 0) {
      await this.setPush(echoId, 'NO_TOKEN', null);
      return;
    }

    const date = fromDbDate(echo.entry.entryDate);
    try {
      const results = await this.push.send(
        tokens.map((t) => {
          const content = echoPushContent({
            date,
            message: echo.message,
            showPreview: setting.showPreview,
            platform: t.platform,
          });
          return {
            to: t.token,
            ...content,
            channelId: PUSH_CHANNEL,
            data: {
              type: 'echo',
              echoId: echo.id,
              ...(echo.sessionId ? { sessionId: echo.sessionId } : {}),
            },
          };
        }),
      );
      const invalid = results.filter((r) => r.invalidToken).map((r) => r.token);
      if (invalid.length > 0) {
        await this.prisma.pushToken.deleteMany({
          where: { token: { in: invalid } },
        });
      }
      const ok = results.some((r) => r.ok);
      await this.prisma.echo.update({
        where: { id: echoId },
        data: {
          pushStatus: ok ? 'SENT' : 'FAILED',
          pushAttempts: { increment: 1 },
          pushError: ok ? null : (results[0]?.error ?? 'unknown').slice(0, 100),
        },
      });
    } catch (e) {
      await this.prisma.echo.update({
        where: { id: echoId },
        data: {
          pushStatus: 'FAILED',
          pushAttempts: { increment: 1 },
          pushError: (e instanceof Error ? e.message : String(e)).slice(0, 100),
        },
      });
    }
  }

  // 전달에 실패한 알림만 다시 보낸다 (최근 6시간, 3번까지)
  async retryFailedPushes(now = new Date()): Promise<void> {
    const failed = await this.prisma.echo.findMany({
      where: {
        pushStatus: 'FAILED',
        pushAttempts: { lt: MAX_PUSH_ATTEMPTS },
        createdAt: { gte: new Date(now.getTime() - PUSH_RETRY_WINDOW_MS) },
      },
      select: { id: true },
      take: 100,
    });
    for (const f of failed) await this.deliver(f.id);
  }

  private async setPush(
    echoId: string,
    status: 'SKIPPED' | 'NO_TOKEN',
    error: string | null,
  ) {
    await this.prisma.echo.update({
      where: { id: echoId },
      data: { pushStatus: status, pushError: error },
    });
  }
}
