import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { fromDbDate, toDbDate } from '../common/dates.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { AiClient } from './ai-client.service.js';
import { mockPastChat } from './mock-past-chat.js';
import type {
  ClarificationRequest,
  ClarificationResult,
  DiaryGenerateRequest,
  DiaryGenerateResult,
  ImageAnalysis,
  IndexDiaryRequest,
  IndexResult,
  PastChatRequest,
  PastChatResult,
} from './ai-client.types.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// 시연·개발용 가짜 AI. AI_MOCK=true면 AiClient 대신 주입된다.
// 실제 AI 서버·Gemini를 부르지 않고, 입력을 조금 반영한 고정 응답을 돌려준다.
export class MockAiClient extends AiClient {
  private readonly delayMs: number;
  private readonly mockLogger = new Logger('MockAiClient');

  constructor(
    config: ConfigService,
    // 과거의 나 대답에 실제 일기를 읽으려고 DB를 쓴다
    private readonly prisma: PrismaService,
  ) {
    super(config);
    this.delayMs = Number(config.get('AI_MOCK_DELAY_MS', 800));
    this.mockLogger.warn('AI_MOCK=true — 가짜 AI 응답을 사용합니다');
  }

  // 시연 영상용: 메이커톤 팀 회의 사진을 넣는다고 보고 그 장면에 맞춘 응답
  override async analyzeImages(): Promise<ImageAnalysis> {
    await sleep(this.delayMs);
    return {
      location: '회의실로 보이는 밝은 실내',
      people: ['여러 명이 테이블에 둘러앉아 있음'],
      actions: ['노트북 화면을 함께 보며 회의하는 중'],
      objects: ['노트북', '화이트보드', '포스트잇', '커피'],
      atmosphere: '다들 화면에 집중한 진지한 분위기',
      uncertain_information: ['함께한 사람', '회의 주제'],
    };
  }

  override async clarify(
    req: ClarificationRequest,
  ): Promise<ClarificationResult> {
    await sleep(this.delayMs);
    // 설명이 충분히 길면 질문하지 않는다 (실제 AI의 판단을 흉내)
    if ((req.description ?? '').length >= 40) {
      return { needs_clarification: false, questions: [] };
    }
    return {
      needs_clarification: true,
      questions: [
        {
          id: 'q1',
          question: '오늘 함께 회의한 사람은 누구였나요?',
          reason: '사진만으로는 누구와 함께였는지 알 수 없어요.',
        },
        {
          id: 'q2',
          question: '어떤 이야기를 나눈 회의였나요?',
          reason: '회의 주제가 사진에 드러나지 않아요.',
        },
      ],
    };
  }

  override async generateDiary(
    req: DiaryGenerateRequest,
  ): Promise<DiaryGenerateResult> {
    await sleep(this.delayMs * 2);
    const answers = Object.values(req.clarification_answers ?? {}).filter(
      (a): a is string => !!a,
    );
    const checked = Object.keys(req.checklist ?? {}).map((k) =>
      k.split('/').pop(),
    );
    const sentence = (t: string) => {
      const s = t.trim();
      return /[.!?…]$/.test(s) ? s : `${s}.`;
    };
    const lines = [
      req.description
        ? sentence(req.description.split('\n')[0])
        : '오늘은 메이커톤 팀원들과 모여 회의를 했다.',
      ...answers.map(sentence),
      '노트북 화면과 화이트보드를 번갈아 보며 아이디어를 하나씩 정리했다.',
      '의견이 부딪히는 순간도 있었지만, 결국 같은 방향을 찾아가는 과정이 꽤 즐거웠다.',
      checked.length > 0
        ? `오늘은 ${checked.join(', ')}까지 챙긴 하루였다.`
        : '',
      '남은 기간도 이 팀이라면 끝까지 해낼 수 있을 것 같다.',
    ];
    return {
      diary_date: req.diary_date,
      content: lines.filter(Boolean).join(' '),
    };
  }

  override async indexDiary(req: IndexDiaryRequest): Promise<IndexResult> {
    await sleep(100);
    return { user_id: req.user_id, diary_id: req.diary_id, indexed: true };
  }

  override async deleteDiaryIndex(
    userId: string,
    diaryId: string,
  ): Promise<IndexResult> {
    await sleep(100);
    return { user_id: userId, diary_id: diaryId, indexed: false };
  }

  // 과거의 나: 기준일까지 실제로 확정한 일기를 읽어서, 질문에 맞는 날의 일기로 그때의 나처럼 답한다
  override async pastChat(req: PastChatRequest): Promise<PastChatResult> {
    await sleep(this.delayMs);
    const rows = await this.prisma.entry.findMany({
      where: {
        userId: req.user_id,
        status: 'CONFIRMED',
        excludedFromMemory: false,
        entryDate: { lte: toDbDate(req.target_date) },
        finalContent: { not: null },
      },
      orderBy: { entryDate: 'desc' },
      take: 200,
      select: { id: true, entryDate: true, finalContent: true, note: true },
    });
    const { answer, references } = mockPastChat(
      req.message,
      req.target_date,
      rows.map((r) => ({
        id: r.id,
        date: fromDbDate(r.entryDate),
        content: r.finalContent ?? '',
        note: r.note,
      })),
    );
    return {
      user_id: req.user_id,
      target_date: req.target_date,
      answer,
      references,
    };
  }
}
