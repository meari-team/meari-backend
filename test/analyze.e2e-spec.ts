import type { INestApplication } from '@nestjs/common';
import { rm } from 'node:fs/promises';
import sharp from 'sharp';
import request from 'supertest';
import { AiClientError } from './../src/ai-client/ai-client.error.js';
import { AiClient } from './../src/ai-client/ai-client.service.js';
import type {
  ClarificationRequest,
  ClarificationResult,
  ImageAnalysis,
  ImageFile,
} from './../src/ai-client/ai-client.types.js';
import { PrismaService } from './../src/prisma/prisma.service.js';
import { createTestApp, signupUser } from './utils/create-app.js';

const ANALYSIS: ImageAnalysis = {
  location: '카페',
  people: [],
  actions: [],
  objects: ['컵'],
  atmosphere: null,
  uncertain_information: ['함께 있는 사람'],
};
const TWO_QUESTIONS: ClarificationResult = {
  needs_clarification: true,
  questions: [
    {
      id: 'q1',
      question: '누구와 함께였나요?',
      reason: '동행이 보이지 않아요.',
    },
    { id: 'q2', question: '왜 갔나요?', reason: '목적을 알 수 없어요.' },
  ],
};

// AI 서버 대역 (vi.fn 대신 직접 — entries.e2e-spec.ts 메모 참고)
const ai = {
  analyzeCalls: [] as { images: ImageFile[]; description: string }[],
  clarifyCalls: [] as ClarificationRequest[],
  clarifyResult: TWO_QUESTIONS,
  failWith: null as Error | null,
  analyzeImages(images: ImageFile[], description: string) {
    this.analyzeCalls.push({ images, description });
    return this.failWith
      ? Promise.reject(this.failWith)
      : Promise.resolve(ANALYSIS);
  },
  clarify(req: ClarificationRequest) {
    this.clarifyCalls.push(req);
    return Promise.resolve(this.clarifyResult);
  },
};

describe('Analyze & Answers (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let me: { token: string; userId: string };

  beforeAll(async () => {
    app = await createTestApp((b) => b.overrideProvider(AiClient).useValue(ai));
    prisma = app.get(PrismaService);
    me = await signupUser(app, 'analyze');
  });

  afterAll(async () => {
    await app.close();
    await rm('.test-uploads', { recursive: true, force: true });
  });

  beforeEach(() => {
    ai.analyzeCalls = [];
    ai.clarifyCalls = [];
    ai.clarifyResult = TWO_QUESTIONS;
    ai.failWith = null;
  });

  const server = () => request(app.getHttpServer());
  const bearer = () => `Bearer ${me.token}`;
  const photo = () =>
    sharp({
      create: { width: 64, height: 64, channels: 3, background: '#88aacc' },
    })
      .jpeg()
      .toBuffer();

  // 일기 만들기: 설명·체크·사진(캡션)
  const prepare = async (date: string, withPhoto = true) => {
    const categories = (
      await server()
        .get('/api/v1/checklist/categories')
        .set('Authorization', bearer())
    ).body.items;
    await server()
      .put(`/api/v1/entries/${date}`)
      .set('Authorization', bearer())
      .send({
        note: '수업 끝나고',
        checkedItemIds: [categories[1].items[2].id],
      }) // 식사/카페
      .expect(201);
    if (withPhoto) {
      await server()
        .post(`/api/v1/entries/${date}/photos`)
        .set('Authorization', bearer())
        .attach('files', await photo(), {
          filename: 'a.jpg',
          contentType: 'image/jpeg',
        })
        .field('captions', '["창가 자리"]')
        .expect(201);
    }
  };
  const analyze = (date: string) =>
    server()
      .post(`/api/v1/entries/${date}/analyze`)
      .set('Authorization', bearer());
  const answers = (date: string, body: object) =>
    server()
      .put(`/api/v1/entries/${date}/answers`)
      .set('Authorization', bearer())
      .send(body);

  describe('POST /analyze (G1)', () => {
    it('사진·설명·체크리스트로 분석하고 질문 2개를 저장한다 → QUESTIONING', async () => {
      await prepare('2026-05-01');
      const res = await analyze('2026-05-01').expect(200);

      expect(res.body.status).toBe('QUESTIONING');
      expect(res.body.questions).toEqual([
        {
          id: expect.any(String),
          question: '누구와 함께였나요?',
          reason: '동행이 보이지 않아요.',
          options: null,
          answer: null,
          skipped: false,
        },
        expect.objectContaining({ question: '왜 갔나요?' }),
      ]);

      expect(ai.analyzeCalls).toHaveLength(1);
      expect(ai.analyzeCalls[0].images).toHaveLength(1);
      expect(ai.analyzeCalls[0].images[0].mimetype).toBe('image/jpeg');
      expect(ai.analyzeCalls[0].description).toBe(
        '수업 끝나고\n사진 1: 창가 자리',
      );
      expect(ai.clarifyCalls[0]).toEqual({
        image_analysis: ANALYSIS,
        description: '수업 끝나고\n사진 1: 창가 자리',
        checklist: { '식사/카페': true },
        diary_date: '2026-05-01',
      });
    });

    it('다시 분석하면 사진 분석은 재사용하고 질문만 새로 만든다', async () => {
      await prepare('2026-05-02');
      const first = await analyze('2026-05-02').expect(200);
      const second = await analyze('2026-05-02').expect(200);

      expect(ai.analyzeCalls).toHaveLength(1);
      expect(ai.clarifyCalls).toHaveLength(2);
      expect(second.body.questions[0].id).not.toBe(first.body.questions[0].id);
      expect(
        await prisma.entryQuestion.count({
          where: {
            entry: { userId: me.userId, entryDate: new Date('2026-05-02') },
          },
        }),
      ).toBe(2);
    });

    it('사진을 바꾸면 다음 분석 때 사진을 다시 분석한다', async () => {
      await prepare('2026-05-03');
      await analyze('2026-05-03').expect(200);
      await server()
        .post('/api/v1/entries/2026-05-03/photos')
        .set('Authorization', bearer())
        .attach('files', await photo(), {
          filename: 'b.jpg',
          contentType: 'image/jpeg',
        })
        .expect(201);
      await analyze('2026-05-03').expect(200);

      expect(ai.analyzeCalls).toHaveLength(2);
      expect(ai.analyzeCalls[1].images).toHaveLength(2);
    });

    it('질문이 없으면 바로 READY', async () => {
      ai.clarifyResult = { needs_clarification: false, questions: [] };
      await prepare('2026-05-04');
      const res = await analyze('2026-05-04').expect(200);
      expect(res.body).toEqual({ status: 'READY', questions: [] });
    });

    it('사진이 없으면 422 PHOTO_REQUIRED, 일기가 없으면 404', async () => {
      await prepare('2026-05-05', false);
      expect((await analyze('2026-05-05').expect(422)).body.error.code).toBe(
        'PHOTO_REQUIRED',
      );
      await analyze('2026-05-06').expect(404);
      expect(ai.analyzeCalls).toHaveLength(0);
    });

    it('확정된 일기는 409 INVALID_ENTRY_STATE', async () => {
      await prepare('2026-05-07');
      await prisma.entry.updateMany({
        where: { userId: me.userId, entryDate: new Date('2026-05-07') },
        data: { status: 'CONFIRMED' },
      });
      const res = await analyze('2026-05-07').expect(409);
      expect(res.body.error).toMatchObject({
        code: 'INVALID_ENTRY_STATE',
        details: { status: 'CONFIRMED' },
      });
    });

    it('AI가 실패하면 502를 돌려주고 일기 상태는 그대로', async () => {
      await prepare('2026-05-08');
      ai.failWith = new AiClientError(
        'AI_UPSTREAM_ERROR',
        502,
        '일기를 만드는 중 문제가 생겼어요.',
        { type: 'http', status: 502, aiCode: 'ai_provider_error' },
        false,
      );
      expect((await analyze('2026-05-08').expect(502)).body.error.code).toBe(
        'AI_UPSTREAM_ERROR',
      );

      const entry = await prisma.entry.findFirstOrThrow({
        where: { userId: me.userId, entryDate: new Date('2026-05-08') },
      });
      expect(entry.status).toBe('DRAFT');
      expect(entry.imageAnalysis).toBeNull();
    });
  });

  describe('PUT /answers (G2)', () => {
    it('일부만 답하면 QUESTIONING, 나머지를 건너뛰면 READY', async () => {
      await prepare('2026-05-10');
      const { body } = await analyze('2026-05-10').expect(200);
      const [q1, q2] = body.questions;

      const partial = await answers('2026-05-10', {
        answers: [{ questionId: q1.id, answer: '  민지랑  ' }],
      }).expect(200);
      expect(partial.body.status).toBe('QUESTIONING');
      expect(partial.body.questions[0]).toMatchObject({
        answer: '민지랑',
        skipped: false,
      });

      const done = await answers('2026-05-10', {
        answers: [{ questionId: q2.id, skipped: true }],
      }).expect(200);
      expect(done.body.status).toBe('READY');
      expect(done.body.questions[1]).toMatchObject({
        answer: null,
        skipped: true,
      });
    });

    it('다른 일기의 질문 ID, answer와 skipped 동시, 빈 답은 400', async () => {
      await prepare('2026-05-11');
      await prepare('2026-05-12');
      const a = (await analyze('2026-05-11').expect(200)).body.questions[0];
      const b = (await analyze('2026-05-12').expect(200)).body.questions[0];

      await answers('2026-05-11', {
        answers: [{ questionId: b.id, answer: 'x' }],
      }).expect(400);
      await answers('2026-05-11', {
        answers: [{ questionId: a.id, answer: 'x', skipped: true }],
      }).expect(400);
      await answers('2026-05-11', {
        answers: [{ questionId: a.id, answer: '   ' }],
      }).expect(400);
    });

    it('QUESTIONING이 아니면 409', async () => {
      ai.clarifyResult = { needs_clarification: false, questions: [] };
      await prepare('2026-05-13');
      await analyze('2026-05-13').expect(200); // READY
      await answers('2026-05-13', { answers: [] }).expect(409);
    });
  });
});
