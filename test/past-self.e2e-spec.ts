import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AiClientError } from './../src/ai-client/ai-client.error.js';
import { AiClient } from './../src/ai-client/ai-client.service.js';
import type {
  PastChatReference,
  PastChatRequest,
} from './../src/ai-client/ai-client.types.js';
import { todayKst } from './../src/common/pipes/parse-date.pipe.js';
import { MAX_USER_MESSAGES } from './../src/past-self/past-self.service.js';
import { PrismaService } from './../src/prisma/prisma.service.js';
import { createTestApp, signupUser } from './utils/create-app.js';

// AI 서버 대역 (vi.fn 대신 직접 — entries.e2e-spec.ts 메모 참고)
const ai = {
  requests: [] as PastChatRequest[],
  references: [] as PastChatReference[],
  failWith: null as Error | null,
  pastChat(req: PastChatRequest) {
    this.requests.push(req);
    if (this.failWith) return Promise.reject(this.failWith);
    return Promise.resolve({
      user_id: req.user_id,
      target_date: req.target_date,
      answer: `(${req.target_date}의 나) ${req.message}에 대한 대답`,
      references: this.references,
    });
  },
  indexDiary: () => Promise.resolve({ indexed: true }),
  deleteDiaryIndex: () => Promise.resolve({ indexed: false }),
};

const shift = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

describe('Past self (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let me: { token: string; userId: string };
  let other: { token: string; userId: string };
  const today = todayKst();
  // 오늘 기준 10~1일 전 확정 일기 10편 (+ 미확정 1편, 제외 1편)
  const mine: { id: string; date: string }[] = [];
  let otherEntryId: string;

  beforeAll(async () => {
    app = await createTestApp((b) => b.overrideProvider(AiClient).useValue(ai));
    prisma = app.get(PrismaService);
    me = await signupUser(app, 'past');
    other = await signupUser(app, 'past-other');

    for (let i = 10; i >= 1; i--) {
      const date = shift(today, -i);
      const e = await prisma.entry.create({
        data: {
          userId: me.userId,
          entryDate: new Date(`${date}T00:00:00Z`),
          status: 'CONFIRMED',
          finalContent: `${date} 일기`,
          aiIndexStatus: 'INDEXED',
        },
      });
      mine.push({ id: e.id, date });
    }
    await prisma.entry.create({
      data: {
        userId: me.userId,
        entryDate: new Date(`${shift(today, -20)}T00:00:00Z`),
        status: 'GENERATED',
      },
    });
    await prisma.entry.create({
      data: {
        userId: me.userId,
        entryDate: new Date(`${shift(today, -21)}T00:00:00Z`),
        status: 'CONFIRMED',
        finalContent: 'x',
        excludedFromMemory: true,
      },
    });
    otherEntryId = (
      await prisma.entry.create({
        data: {
          userId: other.userId,
          entryDate: new Date(`${shift(today, -5)}T00:00:00Z`),
          status: 'CONFIRMED',
          finalContent: '남의 일기',
        },
      })
    ).id;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    ai.requests = [];
    ai.references = [];
    ai.failWith = null;
  });

  const as = (who: { token: string }) => {
    const auth = (r: request.Test) =>
      r.set('Authorization', `Bearer ${who.token}`);
    return {
      get: (p: string) => auth(request(app.getHttpServer()).get(p)),
      post: (p: string, body: object) =>
        auth(request(app.getHttpServer()).post(p).send(body)),
    };
  };
  const newSession = async (anchorDate: string) =>
    (await as(me).post('/api/v1/chat/sessions', { anchorDate }).expect(201))
      .body.id as string;

  describe('GET /past-self/availability (H1)', () => {
    it('확정·미제외 일기만 T 이전(당일 포함)으로 센다', async () => {
      const t = shift(today, -4); // 10~4일 전 = 7편
      const res = await as(me)
        .get(`/api/v1/past-self/availability?anchorDate=${t}`)
        .expect(200);
      expect(res.body).toEqual({
        anchorDate: t,
        available: true,
        recordCount: 7,
        firstRecordDate: shift(today, -10),
        requiredCount: 7,
      });

      const short = await as(me)
        .get(`/api/v1/past-self/availability?anchorDate=${shift(today, -5)}`)
        .expect(200);
      expect(short.body).toMatchObject({ available: false, recordCount: 6 });
    });

    it('anchorDate가 없으면 프리셋 5개', async () => {
      const res = await as(me)
        .get('/api/v1/past-self/availability')
        .expect(200);
      expect(res.body.items.map((i: { preset: string }) => i.preset)).toEqual([
        '1W',
        '1M',
        '3M',
        '6M',
        '1Y',
      ]);
      expect(res.body.items[0]).toMatchObject({
        anchorDate: shift(today, -7),
        recordCount: 4,
        available: false,
      });
    });

    it('미래 날짜는 422', async () => {
      await as(me)
        .get(`/api/v1/past-self/availability?anchorDate=${shift(today, 1)}`)
        .expect(422);
    });
  });

  describe('POST /chat/sessions (H2)', () => {
    it('기록이 7일 미만이면 422 NOT_ENOUGH_RECORDS (현재 수 포함)', async () => {
      const res = await as(me)
        .post('/api/v1/chat/sessions', { anchorDate: shift(today, -5) })
        .expect(422);
      expect(res.body.error).toMatchObject({
        code: 'NOT_ENOUGH_RECORDS',
        details: { recordCount: 6, required: 7 },
      });
    });

    it('7일 이상이면 201', async () => {
      const res = await as(me)
        .post('/api/v1/chat/sessions', { anchorDate: shift(today, -4) })
        .expect(201);
      expect(res.body).toMatchObject({
        anchorDate: shift(today, -4),
        messageCount: 0,
        lastMessageAt: null,
        lastMessagePreview: null,
      });
    });
  });

  describe('POST /chat/sessions/:id/messages (H5)', () => {
    it('T와 본인 ID로 AI에 묻고, 근거는 서버가 다시 걸러 날짜순으로', async () => {
      const t = shift(today, -3);
      const id = await newSession(t);
      const afterT = mine.find((m) => m.date === shift(today, -2))!;
      const ok1 = mine.find((m) => m.date === shift(today, -9))!;
      const ok2 = mine.find((m) => m.date === shift(today, -6))!;
      ai.references = [
        { diary_id: ok2.id, diary_date: ok2.date },
        { diary_id: afterT.id, diary_date: afterT.date }, // T 이후 → 제거
        { diary_id: otherEntryId, diary_date: shift(today, -5) }, // 남의 일기 → 제거
        { diary_id: '00000000-0000-4000-8000-000000000000', diary_date: t }, // 없는 일기 → 제거
        { diary_id: ok1.id, diary_date: ok1.date },
        { diary_id: ok1.id, diary_date: ok1.date }, // 중복
      ];

      const res = await as(me)
        .post(`/api/v1/chat/sessions/${id}/messages`, {
          content: ' 요즘 뭐 해? ',
        })
        .expect(201);

      expect(ai.requests).toEqual([
        {
          user_id: me.userId,
          target_date: t,
          message: '요즘 뭐 해?',
          top_k: 8,
        },
      ]);
      expect(res.body.userMessage).toMatchObject({
        role: 'USER',
        content: '요즘 뭐 해?',
        citations: [],
        flag: 'NONE',
      });
      expect(res.body.assistantMessage).toMatchObject({
        role: 'ASSISTANT',
        flag: 'NONE',
        citations: [
          { entryId: ok1.id, date: ok1.date },
          { entryId: ok2.id, date: ok2.date },
        ],
      });
    });

    it('남는 근거가 없으면 NO_EVIDENCE', async () => {
      const id = await newSession(shift(today, -3));
      ai.references = [
        { diary_id: otherEntryId, diary_date: shift(today, -5) },
      ];
      const res = await as(me)
        .post(`/api/v1/chat/sessions/${id}/messages`, { content: '안녕' })
        .expect(201);
      expect(res.body.assistantMessage).toMatchObject({
        flag: 'NO_EVIDENCE',
        citations: [],
      });
    });

    it('AI가 실패하면 502이고 메시지를 저장하지 않는다', async () => {
      const id = await newSession(shift(today, -3));
      ai.failWith = new AiClientError(
        'AI_UPSTREAM_ERROR',
        502,
        'x',
        { type: 'http', status: 502, aiCode: 'ai_provider_error' },
        false,
      );
      await as(me)
        .post(`/api/v1/chat/sessions/${id}/messages`, { content: '안녕' })
        .expect(502);
      expect(await prisma.chatMessage.count({ where: { sessionId: id } })).toBe(
        0,
      );
    });

    it(`사용자 메시지 ${MAX_USER_MESSAGES}개를 넘으면 422 SESSION_MESSAGE_LIMIT`, async () => {
      const id = await newSession(shift(today, -3));
      await prisma.chatMessage.createMany({
        data: Array.from({ length: MAX_USER_MESSAGES }, (_, i) => ({
          sessionId: id,
          role: 'USER' as const,
          content: `${i}`,
        })),
      });
      const res = await as(me)
        .post(`/api/v1/chat/sessions/${id}/messages`, { content: '하나 더' })
        .expect(422);
      expect(res.body.error.code).toBe('SESSION_MESSAGE_LIMIT');
      expect(ai.requests).toHaveLength(0);
    });

    it('남의 세션에는 보낼 수도, 읽을 수도 없다 (404)', async () => {
      const id = await newSession(shift(today, -3));
      await as(other)
        .post(`/api/v1/chat/sessions/${id}/messages`, { content: '몰래' })
        .expect(404);
      await as(other).get(`/api/v1/chat/sessions/${id}/messages`).expect(404);
      expect(ai.requests).toHaveLength(0);
    });
  });

  describe('GET 목록 (H3·H4)', () => {
    it('메시지는 최근 limit개를 오래된 순으로, nextCursor로 이전 페이지', async () => {
      const id = await newSession(shift(today, -3));
      for (let i = 1; i <= 3; i++) {
        await as(me)
          .post(`/api/v1/chat/sessions/${id}/messages`, {
            content: `질문 ${i}`,
          })
          .expect(201);
      }
      const latest = await as(me)
        .get(`/api/v1/chat/sessions/${id}/messages?limit=4`)
        .expect(200);
      expect(
        latest.body.items.map((m: { content: string }) =>
          m.content.slice(0, 4),
        ),
      ).toEqual([
        '질문 2',
        `(${shift(today, -3)}`.slice(0, 4),
        '질문 3',
        `(${shift(today, -3)}`.slice(0, 4),
      ]);
      expect(latest.body.nextCursor).toBe(latest.body.items[0].id);

      const older = await as(me)
        .get(
          `/api/v1/chat/sessions/${id}/messages?limit=4&cursor=${latest.body.nextCursor}`,
        )
        .expect(200);
      expect(older.body.items.map((m: { role: string }) => m.role)).toEqual([
        'USER',
        'ASSISTANT',
      ]);
      expect(older.body.items[0].content).toBe('질문 1');
      expect(older.body.nextCursor).toBeNull();
    });

    it('세션 목록은 최근 대화순, 마지막 메시지 미리보기와 메시지 수', async () => {
      const quiet = await newSession(shift(today, -4));
      const active = await newSession(shift(today, -3));
      await as(me)
        .post(`/api/v1/chat/sessions/${active}/messages`, {
          content: '최근 대화',
        })
        .expect(201);

      const res = await as(me).get('/api/v1/chat/sessions').expect(200);
      const ids = res.body.items.map((s: { id: string }) => s.id);
      expect(ids.indexOf(active)).toBeLessThan(ids.indexOf(quiet));
      expect(res.body.items[0]).toMatchObject({
        id: active,
        messageCount: 2,
        lastMessagePreview: expect.stringContaining('최근 대화'),
      });

      const theirs = await as(other).get('/api/v1/chat/sessions').expect(200);
      expect(theirs.body.items).toEqual([]);
    });
  });
});
