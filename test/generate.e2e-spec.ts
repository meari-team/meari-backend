import type { INestApplication } from '@nestjs/common';
import { rm } from 'node:fs/promises';
import sharp from 'sharp';
import request from 'supertest';
import { AiClientError } from './../src/ai-client/ai-client.error.js';
import { AiClient } from './../src/ai-client/ai-client.service.js';
import type {
  ClarificationResult,
  DiaryGenerateRequest,
  ImageAnalysis,
} from './../src/ai-client/ai-client.types.js';
import { PrismaService } from './../src/prisma/prisma.service.js';
import { createTestApp, signupUser } from './utils/create-app.js';

const ANALYSIS: ImageAnalysis = {
  location: '카페',
  people: [],
  actions: [],
  objects: ['컵'],
  atmosphere: null,
  uncertain_information: [],
};
const QUESTIONS: ClarificationResult = {
  needs_clarification: true,
  questions: [
    { id: 'q1', question: '누구와?', reason: 'r1' },
    { id: 'q2', question: '왜?', reason: 'r2' },
  ],
};

// AI 서버 대역 (vi.fn 대신 직접 — entries.e2e-spec.ts 메모 참고)
const ai = {
  generateCalls: [] as DiaryGenerateRequest[],
  clarifyResult: QUESTIONS,
  failWith: null as Error | null,
  draft: '오늘은 민지와 카페에 갔다.',
  analyzeImages: () => Promise.resolve(ANALYSIS),
  indexDiary: () => Promise.resolve({ indexed: true }),
  deleteDiaryIndex: () => Promise.resolve({ indexed: false }),
  clarify() {
    return Promise.resolve(this.clarifyResult);
  },
  generateDiary(req: DiaryGenerateRequest) {
    this.generateCalls.push(req);
    return this.failWith
      ? Promise.reject(this.failWith)
      : Promise.resolve({ diary_date: req.diary_date, content: this.draft });
  },
};

describe('Generate & Confirm (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let me: { token: string; userId: string };

  beforeAll(async () => {
    app = await createTestApp((b) => b.overrideProvider(AiClient).useValue(ai));
    prisma = app.get(PrismaService);
    me = await signupUser(app, 'generate');
  });

  afterAll(async () => {
    await app.close();
    await rm('.test-uploads', { recursive: true, force: true });
  });

  beforeEach(() => {
    ai.generateCalls = [];
    ai.clarifyResult = QUESTIONS;
    ai.failWith = null;
  });

  const server = () => request(app.getHttpServer());
  const bearer = () => `Bearer ${me.token}`;
  const post = (path: string, body: object = {}) =>
    server().post(path).set('Authorization', bearer()).send(body);

  // 사진 1장 올리고 분석까지 → QUESTIONING (질문 2개)
  const toQuestioning = async (date: string) => {
    const img = await sharp({
      create: { width: 32, height: 32, channels: 3, background: '#abc' },
    })
      .jpeg()
      .toBuffer();
    await server()
      .put(`/api/v1/entries/${date}`)
      .set('Authorization', bearer())
      .send({ note: '수업 끝나고' })
      .expect(201);
    const up = await server()
      .post(`/api/v1/entries/${date}/photos`)
      .set('Authorization', bearer())
      .attach('files', img, { filename: 'a.jpg', contentType: 'image/jpeg' })
      .expect(201);
    const analyzed = await post(`/api/v1/entries/${date}/analyze`).expect(200);
    return {
      photoId: up.body.items[0].id as string,
      questions: analyzed.body.questions,
    };
  };

  const toReady = async (date: string) => {
    const { photoId, questions } = await toQuestioning(date);
    await server()
      .put(`/api/v1/entries/${date}/answers`)
      .set('Authorization', bearer())
      .send({
        answers: [
          { questionId: questions[0].id, answer: '민지랑' },
          { questionId: questions[1].id, skipped: true },
        ],
      })
      .expect(200);
    return { photoId };
  };

  describe('POST /generate (G3)', () => {
    it('READY에서 초안을 만들고 GENERATED, 대표 사진을 정한다', async () => {
      const { photoId } = await toReady('2026-03-01');
      const res = await post('/api/v1/entries/2026-03-01/generate').expect(200);

      expect(res.body).toEqual({
        status: 'GENERATED',
        aiDraft: '오늘은 민지와 카페에 갔다.',
        aiUncertain: [],
        coverPhotoId: photoId,
      });
      expect(ai.generateCalls[0]).toEqual({
        diary_date: '2026-03-01',
        image_analysis: ANALYSIS,
        description: '수업 끝나고',
        checklist: {},
        clarification_answers: { q1: '민지랑', q2: null },
      });
    });

    it('GENERATED에서 다시 만들면 초안을 바꾼다', async () => {
      await toReady('2026-03-02');
      await post('/api/v1/entries/2026-03-02/generate').expect(200);
      ai.draft = '다시 쓴 초안.';
      const res = await post('/api/v1/entries/2026-03-02/generate').expect(200);
      expect(res.body.aiDraft).toBe('다시 쓴 초안.');
      ai.draft = '오늘은 민지와 카페에 갔다.';
    });

    it('QUESTIONING에서는 409, "그냥 생성"이면 남은 질문을 건너뛰고 생성', async () => {
      await toQuestioning('2026-03-03');
      await post('/api/v1/entries/2026-03-03/generate').expect(409);

      await post('/api/v1/entries/2026-03-03/generate', {
        skipRemainingQuestions: true,
      }).expect(200);
      expect(ai.generateCalls[0].clarification_answers).toEqual({
        q1: null,
        q2: null,
      });

      const entry = await server()
        .get('/api/v1/entries/2026-03-03')
        .set('Authorization', bearer())
        .expect(200);
      expect(
        entry.body.questions.every((q: { skipped: boolean }) => q.skipped),
      ).toBe(true);
    });

    it('질문이 없었으면 clarification_answers는 null', async () => {
      ai.clarifyResult = { needs_clarification: false, questions: [] };
      await toQuestioning('2026-03-04'); // 질문 없음 → READY
      await post('/api/v1/entries/2026-03-04/generate').expect(200);
      expect(ai.generateCalls[0].clarification_answers).toBeNull();
    });

    it('DRAFT·CONFIRMED에서는 409', async () => {
      await server()
        .put('/api/v1/entries/2026-03-05')
        .set('Authorization', bearer())
        .send({})
        .expect(201);
      await post('/api/v1/entries/2026-03-05/generate').expect(409);

      await toReady('2026-03-06');
      await post('/api/v1/entries/2026-03-06/confirm', {
        finalContent: '확정',
      }).expect(200);
      await post('/api/v1/entries/2026-03-06/generate').expect(409);
    });

    it('AI가 실패하면 502, 상태와 초안은 그대로', async () => {
      await toReady('2026-03-07');
      ai.failWith = new AiClientError(
        'AI_TIMEOUT',
        504,
        'AI 응답이 너무 오래 걸려요.',
        { type: 'timeout' },
        false,
      );
      expect(
        (await post('/api/v1/entries/2026-03-07/generate').expect(504)).body
          .error.code,
      ).toBe('AI_TIMEOUT');

      const entry = await prisma.entry.findFirstOrThrow({
        where: { userId: me.userId, entryDate: new Date('2026-03-07') },
      });
      expect(entry.status).toBe('READY');
      expect(entry.aiDraft).toBeNull();
    });
  });

  describe('POST /confirm (G4)', () => {
    it('초안을 고쳐 확정하면 CONFIRMED + 색인 대기, AI 초안은 남긴다', async () => {
      await toReady('2026-03-10');
      await post('/api/v1/entries/2026-03-10/generate').expect(200);
      const res = await post('/api/v1/entries/2026-03-10/confirm', {
        finalContent: '  오늘은 민지와 학교 앞 카페에 갔다.  ',
      }).expect(200);

      expect(res.body).toMatchObject({
        status: 'CONFIRMED',
        finalContent: '오늘은 민지와 학교 앞 카페에 갔다.',
        aiDraft: '오늘은 민지와 카페에 갔다.',
        aiIndexStatus: 'PENDING',
        confirmedAt: expect.any(String),
      });
    });

    it('READY에서 AI 없이 직접 써서 확정할 수 있다', async () => {
      await toReady('2026-03-11');
      const res = await post('/api/v1/entries/2026-03-11/confirm', {
        finalContent: '직접 쓴 일기',
      }).expect(200);
      expect(res.body).toMatchObject({ status: 'CONFIRMED', aiDraft: null });
      expect(ai.generateCalls).toHaveLength(0);
    });

    it('확정된 일기를 고쳐 다시 확정하면 다시 색인 대기', async () => {
      await toReady('2026-03-12');
      await post('/api/v1/entries/2026-03-12/confirm', {
        finalContent: '처음',
      }).expect(200);
      await prisma.entry.updateMany({
        where: { userId: me.userId, entryDate: new Date('2026-03-12') },
        data: { aiIndexStatus: 'INDEXED' },
      });
      const res = await post('/api/v1/entries/2026-03-12/confirm', {
        finalContent: '고친 내용',
      }).expect(200);
      expect(res.body).toMatchObject({
        finalContent: '고친 내용',
        aiIndexStatus: 'PENDING',
      });
    });

    it('기억에서 제외된 일기는 확정해도 색인하지 않는다 (NONE)', async () => {
      await toReady('2026-03-13');
      await prisma.entry.updateMany({
        where: { userId: me.userId, entryDate: new Date('2026-03-13') },
        data: { excludedFromMemory: true },
      });
      const res = await post('/api/v1/entries/2026-03-13/confirm', {
        finalContent: '비밀 일기',
      }).expect(200);
      expect(res.body.aiIndexStatus).toBe('NONE');
    });

    it('DRAFT는 409, 빈 본문·10000자 초과는 400, 없는 일기는 404', async () => {
      await server()
        .put('/api/v1/entries/2026-03-14')
        .set('Authorization', bearer())
        .send({})
        .expect(201);
      await post('/api/v1/entries/2026-03-14/confirm', {
        finalContent: '내용',
      }).expect(409);
      await post('/api/v1/entries/2026-03-14/confirm', {
        finalContent: '   ',
      }).expect(400);
      await post('/api/v1/entries/2026-03-14/confirm', {
        finalContent: 'a'.repeat(10001),
      }).expect(400);
      await post('/api/v1/entries/2026-03-15/confirm', {
        finalContent: '내용',
      }).expect(404);
    });
  });
});
