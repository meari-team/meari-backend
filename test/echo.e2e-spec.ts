import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AiClient } from './../src/ai-client/ai-client.service.js';
import type {
  PastChatReference,
  PastChatRequest,
} from './../src/ai-client/ai-client.types.js';
import { todayKst } from './../src/common/pipes/parse-date.pipe.js';
import { EchoService } from './../src/echo/echo.service.js';
import { PushSender, type PushMessage } from './../src/echo/push-sender.js';
import { PrismaService } from './../src/prisma/prisma.service.js';
import { createTestApp, signupUser } from './utils/create-app.js';

// AI 서버 대역. onCall로 '생성 중에 상태가 바뀌는' 상황을 흉내 낸다
const ai = {
  requests: [] as PastChatRequest[],
  answer: null as
    | ((req: PastChatRequest) => {
        answer: string;
        references: PastChatReference[];
      })
    | null,
  failWith: null as Error | null,
  onCall: null as (() => Promise<void>) | null,
  async pastChat(req: PastChatRequest) {
    this.requests.push(req);
    if (this.onCall) await this.onCall();
    if (this.failWith) throw this.failWith;
    const r = this.answer?.(req) ?? { answer: '기억이 안 나.', references: [] };
    return { user_id: req.user_id, target_date: req.target_date, ...r };
  },
  indexDiary: () => Promise.resolve({ indexed: true }),
  deleteDiaryIndex: () => Promise.resolve({ indexed: false }),
};

// Expo 푸시 대역
const push = {
  available: true,
  sent: [] as PushMessage[],
  failWith: null as Error | null,
  send(messages: PushMessage[]) {
    if (this.failWith) return Promise.reject(this.failWith);
    this.sent.push(...messages);
    return Promise.resolve(
      messages.map((m) => ({ token: m.to, ok: true, invalidToken: false })),
    );
  },
};

const shift = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const db = (date: string) => new Date(`${date}T00:00:00Z`);

describe('Echo (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let echo: EchoService;
  let me: { token: string; userId: string };
  let other: { token: string; userId: string };
  const today = todayKst();
  // 10~1일 전 확정 일기 10편. 9일 전 일기에는 사진 1장
  const mine: { id: string; date: string }[] = [];

  beforeAll(async () => {
    process.env.ECHO_DEMO = 'true';
    app = await createTestApp((b) =>
      b
        .overrideProvider(AiClient)
        .useValue(ai)
        .overrideProvider(PushSender)
        .useValue(push),
    );
    delete process.env.ECHO_DEMO;
    prisma = app.get(PrismaService);
    echo = app.get(EchoService);
    me = await signupUser(app, 'echo');
    other = await signupUser(app, 'echo-other');
    for (let i = 10; i >= 1; i--) {
      const date = shift(today, -i);
      const e = await prisma.entry.create({
        data: {
          userId: me.userId,
          entryDate: db(date),
          status: 'CONFIRMED',
          finalContent: `${date} 일기. 팀원들과 회의를 했다.`,
          confirmedAt: new Date(),
          aiIndexStatus: 'INDEXED',
        },
      });
      mine.push({ id: e.id, date });
    }
    await prisma.photo.create({
      data: {
        entryId: mine[1].id,
        userId: me.userId,
        storageKey: 'echo-test/photo.jpg',
        sortOrder: 0,
      },
    });
    await prisma.entry.create({
      data: {
        userId: me.userId,
        entryDate: db(shift(today, -20)),
        status: 'GENERATED',
      },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    ai.requests = [];
    ai.answer = null;
    ai.failWith = null;
    ai.onCall = null;
    push.sent = [];
    push.failWith = null;
    push.available = true;
    // 매 테스트를 깨끗한 상태에서: 메아리·대화·설정·토큰·북마크 초기화
    await prisma.echo.deleteMany({ where: { userId: me.userId } });
    await prisma.chatSession.deleteMany({ where: { userId: me.userId } });
    await prisma.echoSetting.deleteMany({ where: { userId: me.userId } });
    await prisma.pushToken.deleteMany({ where: { userId: me.userId } });
    await prisma.entry.updateMany({
      where: { userId: me.userId },
      data: { bookmarkedAt: null, excludedFromMemory: false },
    });
  });

  const as = (who: { token: string }) => {
    const auth = (r: request.Test) =>
      r.set('Authorization', `Bearer ${who.token}`);
    const http = () => request(app.getHttpServer());
    return {
      get: (p: string) => auth(http().get(p)),
      post: (p: string, body: object = {}) => auth(http().post(p).send(body)),
      put: (p: string, body: object) => auth(http().put(p).send(body)),
      delete: (p: string, body: object = {}) =>
        auth(http().delete(p).send(body)),
    };
  };
  const bookmark = (date: string, bookmarked = true) =>
    as(me).put(`/api/v1/entries/${date}/bookmark`, { bookmarked }).expect(200);
  const enable = (body: object = {}) =>
    as(me)
      .put('/api/v1/me/echo-settings', { enabled: true, ...body })
      .expect(200);
  // 예약 회차가 지금 돌아올 때가 된 것처럼
  const makeDue = async () => {
    const past = new Date(Date.now() - 60_000);
    await prisma.echoSetting.update({
      where: { userId: me.userId },
      data: { nextRunAt: past },
    });
    return past;
  };
  const echoesOf = () => prisma.echo.findMany({ where: { userId: me.userId } });
  // 그 날짜 일기를 근거로 대답하는 AI
  const answersFrom = (text: string) => (req: PastChatRequest) => {
    const e = mine.find((m) => m.date === req.target_date);
    return {
      answer: `내 기록을 보면, ${text}`,
      references: e ? [{ diary_id: e.id, diary_date: e.date }] : [],
    };
  };

  describe('북마크', () => {
    it('확정 일기를 북마크하고 해제한다 (다시 읽어도 유지)', async () => {
      const d = mine[0].date;
      expect((await bookmark(d)).body.bookmarked).toBe(true);
      expect(
        (await as(me).get(`/api/v1/entries/${d}`).expect(200)).body.bookmarked,
      ).toBe(true);
      expect((await bookmark(d, false)).body.bookmarked).toBe(false);
    });

    it('확정하지 않은 일기는 409, 없는 일기·남의 일기는 404', async () => {
      await as(me)
        .put(`/api/v1/entries/${shift(today, -20)}/bookmark`, {
          bookmarked: true,
        })
        .expect(409);
      await as(other)
        .put(`/api/v1/entries/${mine[0].date}/bookmark`, { bookmarked: true })
        .expect(404);
    });
  });

  describe('메아리 설정', () => {
    it('기본은 미동의, 동의하면 다음 예정이 생기고 다시 읽어도 유지', async () => {
      const def = await as(me).get('/api/v1/me/echo-settings').expect(200);
      expect(def.body).toMatchObject({
        enabled: false,
        frequency: 'WEEKLY',
        time: '21:00',
        showPreview: false,
        nextRunAt: null,
        candidateCount: 0,
        demoAvailable: true,
      });

      await bookmark(mine[0].date);
      const on = await enable({
        frequency: 'MONTHLY',
        monthDay: 31,
        time: '08:30',
        timezone: 'Asia/Seoul',
      });
      expect(on.body.enabled).toBe(true);
      expect(new Date(on.body.nextRunAt).getTime()).toBeGreaterThan(Date.now());
      // 08:30 KST = 23:30 UTC (전날)
      expect(on.body.nextRunAt).toMatch(/T23:30:00\.000Z$/);
      const again = await as(me).get('/api/v1/me/echo-settings').expect(200);
      expect(again.body).toMatchObject({
        enabled: true,
        frequency: 'MONTHLY',
        monthDay: 31,
        time: '08:30',
        candidateCount: 1,
      });
    });

    it('미동의로 바꾸면 예약만 지우고 주기 값은 남긴다', async () => {
      await enable({ frequency: 'MONTHLY', monthDay: 15 });
      const off = await as(me)
        .put('/api/v1/me/echo-settings', { enabled: false })
        .expect(200);
      expect(off.body).toMatchObject({
        enabled: false,
        nextRunAt: null,
        frequency: 'MONTHLY',
        monthDay: 15,
      });
    });

    it('다시 동의하면 지금 이후 회차부터 (미동의 기간 회차를 몰아서 보내지 않음)', async () => {
      await bookmark(mine[0].date);
      await enable();
      await makeDue();
      await as(me).put('/api/v1/me/echo-settings', { enabled: false });
      await enable();
      const s = await prisma.echoSetting.findUniqueOrThrow({
        where: { userId: me.userId },
      });
      expect(s.nextRunAt!.getTime()).toBeGreaterThan(Date.now());
      expect(await echo.processDue(new Date())).toBe(0);
      expect(await echoesOf()).toHaveLength(0);
    });

    it('잘못된 시간대·시각은 400', async () => {
      await as(me)
        .put('/api/v1/me/echo-settings', { timezone: 'Mars/Base' })
        .expect(400);
      await as(me)
        .put('/api/v1/me/echo-settings', { time: '25:00' })
        .expect(400);
    });
  });

  describe('예약 회차', () => {
    it('회차가 되면 북마크 일기로 메아리·대화방·첫 메시지를 만들고, 다음 회차로 넘긴다', async () => {
      const target = mine[8]; // 그날까지 기록 9편 → 대화방도 생긴다
      await bookmark(target.date);
      await enable();
      await makeDue();
      ai.answer = answersFrom('팀원들과 회의를 했어.');

      expect(await echo.processDue(new Date())).toBe(1);
      const [e] = await echoesOf();
      expect(e.entryId).toBe(target.id);
      expect(e.source).toBe('AI');
      expect(e.message).toContain('팀원들과 회의를 했어.');
      // 과거의 나 기준일 = 그 일기 날짜
      expect(ai.requests[0].target_date).toBe(target.date);

      const session = await prisma.chatSession.findUniqueOrThrow({
        where: { id: e.sessionId! },
        include: { messages: true },
      });
      expect(session.anchorDate.toISOString().slice(0, 10)).toBe(target.date);
      expect(session.messages).toHaveLength(1);
      expect(session.messages[0]).toMatchObject({
        role: 'ASSISTANT',
        content: e.message,
        citations: [{ entryId: target.id, date: target.date }],
      });

      const s = await prisma.echoSetting.findUniqueOrThrow({
        where: { userId: me.userId },
      });
      expect(s.nextRunAt!.getTime()).toBeGreaterThan(Date.now());
    });

    it('DB가 마이크로초까지 저장한 회차 시각도 놓치지 않는다', async () => {
      await bookmark(mine[8].date);
      await enable();
      await prisma.$executeRaw`update echo_settings set next_run_at = now() - interval '1 minute 0.123456 second' where user_id = ${me.userId}::uuid`;
      expect(await echo.processDue(new Date())).toBe(1);
    });

    it('같은 회차를 다시 실행해도 메아리·대화·알림이 하나뿐', async () => {
      await bookmark(mine[8].date);
      await enable();
      await as(me).post('/api/v1/me/push-tokens', {
        token: 'ExponentPushToken[dup]',
        platform: 'ios',
      });
      const slot = (await makeDue()).toISOString();
      await echo.processDue(new Date());
      // 같은 회차 재실행 (서버 재시작·재시도 흉내)
      expect((await echo.runSlot(me.userId, slot)).status).toBe('exists');
      expect(await echo.processDue(new Date())).toBe(0);
      expect(await echoesOf()).toHaveLength(1);
      expect(
        await prisma.chatSession.count({ where: { userId: me.userId } }),
      ).toBe(1);
      expect(push.sent).toHaveLength(1);
    });

    it('미동의 상태에서는 회차가 와도 만들지 않는다 (북마크·기존 대화는 유지)', async () => {
      await bookmark(mine[0].date);
      await enable();
      await makeDue();
      await echo.processDue(new Date());
      await prisma.echoSetting.update({
        where: { userId: me.userId },
        data: { enabled: false, nextRunAt: new Date(Date.now() - 1000) },
      });
      expect(await echo.processDue(new Date())).toBe(0);
      expect(await echoesOf()).toHaveLength(1);
      expect(
        (await as(me).get(`/api/v1/entries/${mine[0].date}`)).body.bookmarked,
      ).toBe(true);
    });

    it('후보가 없으면 건너뛰고 아무것도 만들지 않는다', async () => {
      await enable();
      await makeDue();
      expect(await echo.processDue(new Date())).toBe(0);
      expect(await echoesOf()).toHaveLength(0);
      expect(ai.requests).toHaveLength(0);
    });

    it('기억에서 제외한 북마크 일기는 후보가 아니다', async () => {
      await bookmark(mine[0].date);
      await prisma.entry.update({
        where: { id: mine[0].id },
        data: { excludedFromMemory: true },
      });
      await enable();
      expect((await echo.runSlot(me.userId, 'x')).status).toBe('no_candidate');
    });

    it('생성 중에 고른 일기의 북마크가 풀리면 다른 후보로 다시 고른다', async () => {
      await bookmark(mine[2].date);
      await bookmark(mine[3].date);
      await enable();
      let first: string | undefined;
      ai.onCall = async () => {
        if (first) return;
        first = ai.requests[0].target_date;
        await bookmark(first, false);
      };
      const r = await echo.runSlot(me.userId, 'repick');
      expect(r.status).toBe('created');
      const [e] = await echoesOf();
      const picked = mine.find((m) => m.id === e.entryId)!;
      expect(picked.date).not.toBe(first);
    });

    it('생성 중에 동의를 거두면 저장하지 않는다', async () => {
      await bookmark(mine[0].date);
      await enable();
      ai.onCall = async () => {
        await prisma.echoSetting.update({
          where: { userId: me.userId },
          data: { enabled: false },
        });
      };
      expect((await echo.runSlot(me.userId, 'withdrawn')).status).toBe(
        'disabled',
      );
      expect(await echoesOf()).toHaveLength(0);
    });

    it('AI가 실패하거나 그 일기를 근거로 삼지 않으면 기본 문구', async () => {
      await bookmark(mine[1].date);
      await enable();
      ai.failWith = new Error('down');
      await echo.runSlot(me.userId, 'ai-fail');
      ai.failWith = null;
      ai.answer = () => ({ answer: '다른 날 이야기야.', references: [] });
      await echo.runSlot(me.userId, 'no-evidence');
      const list = await echoesOf();
      expect(list).toHaveLength(2);
      for (const e of list) {
        expect(e.source).toBe('FALLBACK');
        expect(e.message).toContain('이 사진을 남겼어');
      }
    });

    it('기준일까지 기록이 7일 미만이면 대화방 없이 메아리만 (열람은 가능)', async () => {
      const early = mine[0]; // 10일 전: 그날까지 기록 1편
      await bookmark(early.date);
      await enable();
      await echo.runSlot(me.userId, 'short');
      const [e] = await echoesOf();
      expect(e.sessionId).toBeNull();
      const detail = await as(me).get(`/api/v1/echoes/${e.id}`).expect(200);
      expect(detail.body.chat).toEqual({
        available: false,
        recordCount: 1,
        requiredCount: 7,
      });
      expect(detail.body.finalContent).toContain(early.date);
    });
  });

  describe('알림', () => {
    const due = async () => {
      await bookmark(mine[8].date);
      await enable();
      await makeDue();
    };

    it('푸시 토큰이 없으면 앱 안에만 (NO_TOKEN)', async () => {
      await due();
      await echo.processDue(new Date());
      const [e] = await echoesOf();
      expect(e.pushStatus).toBe('NO_TOKEN');
      expect(push.sent).toHaveLength(0);
      expect(
        (await as(me).get('/api/v1/echoes').expect(200)).body.unreadCount,
      ).toBe(1);
    });

    it('기본은 일반 문구, 데이터에 메아리·대화방 id', async () => {
      await as(me)
        .post('/api/v1/me/push-tokens', {
          token: 'ExponentPushToken[ios]',
          platform: 'ios',
        })
        .expect(204);
      await due();
      ai.answer = answersFrom('비밀 회의를 했어.');
      await echo.processDue(new Date());
      const [e] = await echoesOf();
      expect(e.pushStatus).toBe('SENT');
      expect(push.sent[0]).toMatchObject({
        to: 'ExponentPushToken[ios]',
        title: '기억하고 싶었던 하루가 찾아왔어요',
        subtitle: `${mine[8].date.replaceAll('-', '.')}의 나`,
        body: '메시지가 도착했어요. 눌러서 확인해 보세요.',
        data: { type: 'echo', echoId: e.id, sessionId: e.sessionId },
      });
      expect(JSON.stringify(push.sent[0])).not.toContain('비밀');
    });

    it('미리보기를 켜면 메시지 앞부분', async () => {
      await as(me).post('/api/v1/me/push-tokens', {
        token: 'ExponentPushToken[and]',
        platform: 'android',
      });
      await due();
      await enable({ showPreview: true });
      await makeDue();
      await echo.processDue(new Date());
      expect(push.sent[0].body).toContain('의 나 · ');
      expect(push.sent[0].body).toContain('의 나야.');
    });

    it('푸시가 실패하면 메아리는 남고, 재시도는 알림만 다시 보낸다', async () => {
      await as(me).post('/api/v1/me/push-tokens', {
        token: 'ExponentPushToken[retry]',
        platform: 'ios',
      });
      await due();
      push.failWith = new Error('expo down');
      await echo.processDue(new Date());
      let [e] = await echoesOf();
      expect(e.pushStatus).toBe('FAILED');
      push.failWith = null;
      await echo.retryFailedPushes(new Date());
      [e] = await echoesOf();
      expect(e.pushStatus).toBe('SENT');
      expect(await echoesOf()).toHaveLength(1);
      expect(push.sent).toHaveLength(1);
    });

    it('보내기 직전에 동의를 거두면 알리지 않는다 (SKIPPED)', async () => {
      await as(me).post('/api/v1/me/push-tokens', {
        token: 'ExponentPushToken[skip]',
        platform: 'ios',
      });
      await bookmark(mine[8].date);
      await enable();
      const r = await echo.runSlot(me.userId, 'skip');
      await as(me).put('/api/v1/me/echo-settings', { enabled: false });
      if (r.status === 'created') await echo.deliver(r.echoId);
      const [e] = await echoesOf();
      expect(e.pushStatus).toBe('SKIPPED');
      expect(push.sent).toHaveLength(0);
    });
  });

  describe('받은 메아리·대화', () => {
    const arrive = async (i = 8) => {
      await bookmark(mine[i].date);
      await enable();
      ai.answer = answersFrom('팀원들과 회의를 했어.');
      const r = await echo.runSlot(me.userId, `arrive-${i}`);
      if (r.status !== 'created') throw new Error(r.status);
      return r.echoId;
    };

    it('목록·상세(사진·일기·첫 메시지)·읽음', async () => {
      const id = await arrive(1);
      const list = await as(me).get('/api/v1/echoes').expect(200);
      expect(list.body.unreadCount).toBe(1);
      expect(list.body.items[0]).toMatchObject({ id, entryDate: mine[1].date });

      const d = await as(me).get(`/api/v1/echoes/${id}`).expect(200);
      expect(d.body).toMatchObject({
        id,
        entryDate: mine[1].date,
        source: 'AI',
        citations: [{ entryId: mine[1].id, date: mine[1].date }],
        entryEdited: false,
        chat: { available: false },
      });
      expect(d.body.photos).toHaveLength(1);
      expect(d.body.finalContent).toContain(mine[1].date);

      await as(me).post(`/api/v1/echoes/${id}/read`).expect(204);
      expect((await as(me).get('/api/v1/echoes')).body.unreadCount).toBe(0);
    });

    it('남의 메아리는 볼 수도 읽음 처리할 수도 없다 (404)', async () => {
      const id = await arrive();
      await as(other).get(`/api/v1/echoes/${id}`).expect(404);
      await as(other).post(`/api/v1/echoes/${id}/read`).expect(404);
    });

    it('대화방에서 바로 답장하면 그 일기 날짜까지의 기록으로 답한다', async () => {
      const id = await arrive(8);
      const d = await as(me).get(`/api/v1/echoes/${id}`).expect(200);
      expect(d.body.chat.available).toBe(true);
      const sessions = await as(me).get('/api/v1/chat/sessions').expect(200);
      expect(sessions.body.items[0]).toMatchObject({
        id: d.body.sessionId,
        anchorDate: mine[8].date,
        echoId: id,
      });

      ai.requests = [];
      ai.answer = () => ({
        answer: '그때는 발표 준비 중이었어.',
        references: [
          { diary_id: mine[8].id, diary_date: mine[8].date },
          // 기준일 이후 일기는 서버가 걸러 낸다
          { diary_id: mine[9].id, diary_date: mine[9].date },
        ],
      });
      const res = await as(me)
        .post(`/api/v1/chat/sessions/${d.body.sessionId}/messages`, {
          content: '그날 기억나?',
        })
        .expect(201);
      expect(ai.requests[0].target_date).toBe(mine[8].date);
      expect(res.body.assistantMessage.citations).toEqual([
        { entryId: mine[8].id, date: mine[8].date },
      ]);
      // 답장은 일기를 바꾸지 않는다
      const entry = await prisma.entry.findUniqueOrThrow({
        where: { id: mine[8].id },
      });
      expect(entry.finalContent).toBe(
        `${mine[8].date} 일기. 팀원들과 회의를 했다.`,
      );
    });

    it('북마크를 해제해도 도착한 메아리·대화는 남는다', async () => {
      const id = await arrive();
      await bookmark(mine[8].date, false);
      await as(me).get(`/api/v1/echoes/${id}`).expect(200);
    });

    it('일기를 수정하면 상세에 표시, 삭제하면 메아리·대화방이 함께 지워진다', async () => {
      const id = await arrive(9);
      await prisma.entry.update({
        where: { id: mine[9].id },
        data: { confirmedAt: new Date(Date.now() + 1000) },
      });
      expect((await as(me).get(`/api/v1/echoes/${id}`)).body.entryEdited).toBe(
        true,
      );
      const sessionId = (await prisma.echo.findUniqueOrThrow({ where: { id } }))
        .sessionId!;

      await as(me).delete(`/api/v1/entries/${mine[9].date}`).expect(204);
      await as(me).get(`/api/v1/echoes/${id}`).expect(404);
      expect(
        await prisma.chatSession.findUnique({ where: { id: sessionId } }),
      ).toBeNull();
      // 테스트 데이터 되살리기
      const e = await prisma.entry.create({
        data: {
          userId: me.userId,
          entryDate: db(mine[9].date),
          status: 'CONFIRMED',
          finalContent: `${mine[9].date} 일기. 팀원들과 회의를 했다.`,
          confirmedAt: new Date(),
        },
      });
      mine[9] = { id: e.id, date: mine[9].date };
    });
  });

  describe('시연', () => {
    it('동의 전 409, 후보 없으면 422, 있으면 지금 한 회차', async () => {
      await as(me).post('/api/v1/echoes/demo').expect(409);
      await enable();
      await as(me).post('/api/v1/echoes/demo').expect(422);
      await bookmark(mine[5].date);
      const res = await as(me).post('/api/v1/echoes/demo').expect(201);
      expect(res.body.entryDate).toBe(mine[5].date);
      expect(await echoesOf()).toHaveLength(1);
    });
  });

  it('푸시 토큰은 형식을 확인하고, 해제하면 지운다', async () => {
    await as(me)
      .post('/api/v1/me/push-tokens', { token: 'abc', platform: 'ios' })
      .expect(400);
    await as(me)
      .post('/api/v1/me/push-tokens', {
        token: 'ExponentPushToken[rm]',
        platform: 'ios',
      })
      .expect(204);
    expect(
      (await as(me).get('/api/v1/me/echo-settings')).body.pushRegistered,
    ).toBe(true);
    await as(me)
      .delete('/api/v1/me/push-tokens', { token: 'ExponentPushToken[rm]' })
      .expect(204);
    expect(
      (await as(me).get('/api/v1/me/echo-settings')).body.pushRegistered,
    ).toBe(false);
  });
});
