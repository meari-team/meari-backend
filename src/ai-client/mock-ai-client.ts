import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { AiClient } from './ai-client.service.js';
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

  constructor(config: ConfigService) {
    super(config);
    this.delayMs = Number(config.get('AI_MOCK_DELAY_MS', 800));
    this.mockLogger.warn('AI_MOCK=true — 가짜 AI 응답을 사용합니다');
  }

  override async analyzeImages(): Promise<ImageAnalysis> {
    await sleep(this.delayMs);
    return {
      location: '카페로 보이는 실내',
      people: ['사람 1명'],
      actions: ['음료를 마시는 중'],
      objects: ['테이블', '컵', '노트북'],
      atmosphere: '창가 쪽 밝은 자연광',
      uncertain_information: ['함께 있는 사람', '방문한 이유'],
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
          question: '이곳에서는 누구와 함께였나요?',
          reason: '사진만으로는 함께한 사람을 알 수 없어요.',
        },
        {
          id: 'q2',
          question: '오늘 이곳에 간 이유가 있었나요?',
          reason: '방문 목적이 사진에 드러나지 않아요.',
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
    const lines = [
      req.description
        ? `${req.description.split('\n')[0]}.`
        : '오늘은 카페에 들렀다.',
      ...answers.map((a) => `${a}.`),
      checked.length > 0
        ? `오늘은 ${checked.join(', ')}까지 챙긴 하루였다.`
        : '',
      '창가 자리가 밝아서 기분이 좋았던 것 같다.',
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

  override async pastChat(req: PastChatRequest): Promise<PastChatResult> {
    await sleep(this.delayMs);
    return {
      user_id: req.user_id,
      target_date: req.target_date,
      answer: '그 부분은 남겨 둔 기록이 없어서 잘 모르겠어. (시연용 가짜 응답)',
      references: [],
    };
  }
}
