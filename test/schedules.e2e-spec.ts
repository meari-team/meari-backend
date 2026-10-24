import type { INestApplication } from '@nestjs/common';
import { rm } from 'node:fs/promises';
import sharp from 'sharp';
import request from 'supertest';
import { AiClient } from './../src/ai-client/ai-client.service.js';
import type {
  ClarificationRequest,
  DiaryGenerateRequest,
  ImageAnalysis,
} from './../src/ai-client/ai-client.types.js';
import { MAX_SCHEDULES_PER_DAY } from './../src/schedules/schedules.service.js';
import { PrismaService } from './../src/prisma/prisma.service.js';
import { createTestApp, signupUser } from './utils/create-app.js';

const ANALYSIS: ImageAnalysis = {
  location: null,
  people: [],
  actions: [],
  objects: [],
  atmosphere: null,
  uncertain_information: [],
};

// AI 서버 대역 (vi.fn 대신 직접 — entries.e2e-spec.ts 메모 참고)
const ai = {
  analyzeDescriptions: [] as string[],
  clarifyCalls: [] as ClarificationRequest[],
  generateCalls: [] as DiaryGenerateRequest[],
  analyzeImages(_images: unknown, description: string) {
    this.analyzeDescriptions.push(description);
    return Promise.resolve(ANALYSIS);
  },
  clarify(req: ClarificationRequest) {
    this.clarifyCalls.push(req);
    return Promise.resolve({ needs_clarification: false, questions: [] });
  },
  generateDiary(req: DiaryGenerateRequest) {
    this.generateCalls.push(req);
    return Promise.resolve({ diary_date: req.diary_date, content: '초안' });
  },
  indexDiary: () => Promise.resolve({ indexed: true }),
  deleteDiaryIndex: () => Promise.resolve({ indexed: false }),
};

describe('Schedules (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let me: { token: string; userId: string };
  let other: { token: string; userId: string };

  beforeAll(async () => {
    app = await createTestApp((b) => b.overrideProvider(AiClient).useValue(ai));
    prisma = app.get(PrismaService);
    me = await signupUser(app, 'sched');
    other = await signupUser(app, 'sched-other');
  });

  afterAll(async () => {
    await app.close();
    await rm('.test-uploads', { recursive: true, force: true });
  });

  const as = (who: { token: string }) => {
    const auth = (r: request.Test) =>
      r.set('Authorization', `Bearer ${who.token}`);
    const srv = () => request(app.getHttpServer());
    return {
      get: (p: string) => auth(srv().get(p)),
      post: (p: string, body: object) => auth(srv().post(p).send(body)),
      patch: (p: string, body: object) => auth(srv().patch(p).send(body)),
      del: (p: string) => auth(srv().delete(p)),
    };
  };
  const add = (who: { token: string }, body: object) =>
    as(who).post('/api/v1/schedules', body);

  describe('CRUD', () => {
    it('추가 → 201 ScheduleDto (제목 trim, 시간 없으면 null, 미래 허용)', async () => {
      const res = await add(me, {
        date: '2099-01-01',
        title: '  여행  ',
      }).expect(201);
      expect(res.body).toEqual({
        id: expect.any(String),
        date: '2099-01-01',
        title: '여행',
        time: null,
        completed: false,
        createdAt: expect.any(String),
      });
    });

    it('기간 목록: 날짜 → 시간(종일 먼저) → 등록순, 범위 밖·남의 일정 제외', async () => {
      await add(me, {
        date: '2026-05-02',
        title: '오후',
        time: '14:00',
      }).expect(201);
      await add(me, {
        date: '2026-05-01',
        title: '아침',
        time: '09:00',
      }).expect(201);
      await add(me, { date: '2026-05-01', title: '종일' }).expect(201);
      await add(me, { date: '2026-06-01', title: '범위 밖' }).expect(201);
      await add(other, { date: '2026-05-01', title: '남의 일정' }).expect(201);

      const res = await as(me)
        .get('/api/v1/schedules?from=2026-05-01&to=2026-05-31')
        .expect(200);
      expect(
        res.body.items.map(
          (s: { date: string; title: string }) => `${s.date} ${s.title}`,
        ),
      ).toEqual(['2026-05-01 종일', '2026-05-01 아침', '2026-05-02 오후']);
    });

    it('수정: 제목·날짜·시간, time: null이면 종일', async () => {
      const { body } = await add(me, {
        date: '2026-05-10',
        title: '회의',
        time: '10:00',
      }).expect(201);
      const res = await as(me)
        .patch(`/api/v1/schedules/${body.id}`, {
          title: '팀플 회의',
          date: '2026-05-11',
          time: null,
        })
        .expect(200);
      expect(res.body).toMatchObject({
        id: body.id,
        title: '팀플 회의',
        date: '2026-05-11',
        time: null,
      });
    });

    it('완료 체크: completed 토글, 다른 필드는 그대로', async () => {
      const { body } = await add(me, {
        date: '2026-05-12',
        title: '과제',
        time: '09:00',
      }).expect(201);
      const done = await as(me)
        .patch(`/api/v1/schedules/${body.id}`, { completed: true })
        .expect(200);
      expect(done.body).toMatchObject({
        title: '과제',
        time: '09:00',
        completed: true,
      });
      const undone = await as(me)
        .patch(`/api/v1/schedules/${body.id}`, { completed: false })
        .expect(200);
      expect(undone.body.completed).toBe(false);
      await as(me)
        .patch(`/api/v1/schedules/${body.id}`, { completed: 'yes' })
        .expect(400);
    });

    it('삭제 → 204, 다시 삭제하면 404', async () => {
      const { body } = await add(me, {
        date: '2026-05-12',
        title: '지울 일정',
      }).expect(201);
      await as(me).del(`/api/v1/schedules/${body.id}`).expect(204);
      const res = await as(me).del(`/api/v1/schedules/${body.id}`).expect(404);
      expect(res.body.error.code).toBe('SCHEDULE_NOT_FOUND');
    });

    it('남의 일정은 수정·삭제할 수 없다 (404)', async () => {
      const { body } = await add(other, {
        date: '2026-05-13',
        title: '비밀',
      }).expect(201);
      await as(me)
        .patch(`/api/v1/schedules/${body.id}`, { title: 'x' })
        .expect(404);
      await as(me).del(`/api/v1/schedules/${body.id}`).expect(404);
      expect(await prisma.schedule.count({ where: { id: body.id } })).toBe(1);
    });
  });

  describe('검증', () => {
    it.each([
      ['날짜 형식', { date: '2026/05/01', title: 'a' }],
      ['없는 날짜', { date: '2026-02-30', title: 'a' }],
      ['빈 제목', { date: '2026-05-01', title: '   ' }],
      ['51자 제목', { date: '2026-05-01', title: 'a'.repeat(51) }],
      ['시간 형식', { date: '2026-05-01', title: 'a', time: '24:00' }],
      ['정의 안 된 필드', { date: '2026-05-01', title: 'a', userId: 'x' }],
    ])('%s → 400', async (_, body) => {
      const res = await add(me, body).expect(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('기간: from > to·366일 이상·잘못된 날짜는 400', async () => {
      await as(me)
        .get('/api/v1/schedules?from=2026-05-31&to=2026-05-01')
        .expect(400);
      await as(me)
        .get('/api/v1/schedules?from=2025-01-01&to=2026-01-02')
        .expect(400);
      await as(me)
        .get('/api/v1/schedules?from=2026-02-30&to=2026-03-01')
        .expect(400);
      await as(me)
        .get('/api/v1/schedules?from=2025-01-01&to=2025-12-31')
        .expect(200);
    });

    it(`하루 ${MAX_SCHEDULES_PER_DAY}개를 넘으면 422 (옮겨 오는 수정도)`, async () => {
      await prisma.schedule.createMany({
        data: Array.from({ length: MAX_SCHEDULES_PER_DAY }, (_, i) => ({
          userId: me.userId,
          date: new Date('2026-07-01T00:00:00Z'),
          title: `일정 ${i}`,
        })),
      });
      const res = await add(me, {
        date: '2026-07-01',
        title: '하나 더',
      }).expect(422);
      expect(res.body.error).toMatchObject({
        code: 'SCHEDULE_LIMIT_EXCEEDED',
        details: { max: 20 },
      });

      const { body } = await add(me, {
        date: '2026-07-02',
        title: '옮길 일정',
      }).expect(201);
      await as(me)
        .patch(`/api/v1/schedules/${body.id}`, { date: '2026-07-01' })
        .expect(422);
    });
  });

  it('일기 분석·생성 때 그날 일정이 AI 설명에 들어간다', async () => {
    const date = '2026-08-01';
    await add(me, { date, title: '팀플 회의', time: '14:00' }).expect(201);
    await add(me, { date, title: '동아리 모임' }).expect(201);
    await add(me, { date: '2026-08-02', title: '다른 날' }).expect(201);

    const img = await sharp({
      create: { width: 16, height: 16, channels: 3, background: '#999' },
    })
      .jpeg()
      .toBuffer();
    await request(app.getHttpServer())
      .post(`/api/v1/entries/${date}/photos`)
      .set('Authorization', `Bearer ${me.token}`)
      .attach('files', img, { filename: 'a.jpg', contentType: 'image/jpeg' })
      .expect(201);

    await as(me).post(`/api/v1/entries/${date}/analyze`, {}).expect(200);
    await as(me).post(`/api/v1/entries/${date}/generate`, {}).expect(200);

    const expected = '일정: 동아리 모임\n일정: 14:00 팀플 회의';
    expect(ai.analyzeDescriptions.at(-1)).toBe(expected);
    expect(ai.clarifyCalls.at(-1)?.description).toBe(expected);
    expect(ai.generateCalls.at(-1)?.description).toBe(expected);
  });
});
