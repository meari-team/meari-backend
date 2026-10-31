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

  // 과거의 나: 질문 낱말에 따라 그때(메이커톤 준비 기간)의 나처럼 답한다
  override async pastChat(req: PastChatRequest): Promise<PastChatResult> {
    await sleep(this.delayMs);
    return {
      user_id: req.user_id,
      target_date: req.target_date,
      answer: mockPastAnswer(req.message),
      references: [],
    };
  }
}

const PAST_ANSWERS: { keywords: RegExp; answer: string }[] = [
  {
    keywords: /기분|감정|마음|행복|힘들/,
    answer:
      '그때는 몸은 좀 피곤했어도 마음은 꽤 들떠 있었어. 하고 싶던 걸 팀원들이랑 같이 만들고 있다는 느낌이 컸거든.',
  },
  {
    keywords: /고민|걱정|불안|어려/,
    answer:
      '제일 큰 고민은 정해진 기간 안에 다 끝낼 수 있을까였어. 그래도 회의에서 할 일을 나누고 나니까 하나씩 풀리더라.',
  },
  {
    keywords: /신경|요즘|중요/,
    answer:
      '요즘은 메이커톤 준비가 제일 신경 쓰여. 발표 때 우리가 만든 걸 잘 보여 줄 수 있을지 계속 생각하게 돼.',
  },
  {
    keywords: /팀|친구|사람|누구/,
    answer:
      '팀원들이랑 거의 매일 모였어. 회의할 때 다들 진지했는데, 끝나고 같이 밥 먹으면서 수다 떠는 시간이 제일 좋았어.',
  },
  {
    keywords: /뭐|무엇|했|일/,
    answer:
      '그때 기록을 보면 메이커톤 준비로 바쁘게 지냈어. 회의도 많았고 밤늦게까지 화면을 고치기도 했지만, 그만큼 뿌듯한 날들이었어.',
  },
];

function mockPastAnswer(message: string): string {
  return (
    PAST_ANSWERS.find((a) => a.keywords.test(message))?.answer ??
    '그때 남긴 기록으로는 메이커톤 준비에 푹 빠져 있던 시기였어. 정신없었지만 하루하루가 꽤 즐거웠던 것 같아.'
  );
}
