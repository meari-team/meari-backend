import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AiClientError } from './../src/ai-client/ai-client.error.js';
import { AiClient } from './../src/ai-client/ai-client.service.js';
import type { IndexDiaryRequest } from './../src/ai-client/ai-client.types.js';
import { MemorySyncService } from './../src/memory-sync/memory-sync.service.js';
import { PrismaService } from './../src/prisma/prisma.service.js';
import { createTestApp, signupUser } from './utils/create-app.js';

const indexDown = () =>
  new AiClientError(
    'AI_INDEX_UNAVAILABLE',
    503,
    '기억 저장소에 연결할 수 없어요.',
    { type: 'http', status: 503, aiCode: 'index_unavailable' },
    true,
  );
const badRequest = () =>
  new AiClientError(
    'AI_UPSTREAM_ERROR',
    502,
    'x',
    { type: 'http', status: 422, aiCode: 'validation_error' },
    false,
  );

// AI 서버 대역. 호출 순서를 기록하고, 응답을 테스트가 정한다.
const ai = {
  calls: [] as string[],
  indexRequests: [] as IndexDiaryRequest[],
  // 호출마다 하나씩 꺼내 쓴다. 비면 성공
  indexPlan: [] as (Error | Promise<void>)[],
  async indexDiary(req: IndexDiaryRequest) {
    this.calls.push(`index:${req.content}`);
    this.indexRequests.push(req);
    const step = this.indexPlan.shift();
    if (step instanceof Error) throw step;
    if (step) await step;
    return { user_id: req.user_id, diary_id: req.diary_id, indexed: true };
  },
  deleteDiaryIndex(userId: string, diaryId: string) {
    this.calls.push('delete');
    return Promise.resolve({
      user_id: userId,
      diary_id: diaryId,
      indexed: false,
    });
  },
};

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
};

describe('Memory sync (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let sync: MemorySyncService;
  let me: { token: string; userId: string };

  beforeAll(async () => {
    app = await createTestApp((b) => b.overrideProvider(AiClient).useValue(ai));
    prisma = app.get(PrismaService);
    sync = app.get(MemorySyncService);
    me = await signupUser(app, 'sync');
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    ai.calls = [];
    ai.indexRequests = [];
    ai.indexPlan = [];
  });

  const server = () => request(app.getHttpServer());
  const bearer = () => `Bearer ${me.token}`;

  // 사진·AI 없이 READY 일기를 만든다 (직접 작성 → 확정 경로)
  const ready = async (date: string) => {
    const res = await server()
      .put(`/api/v1/entries/${date}`)
      .set('Authorization', bearer())
      .send({})
      .expect(201);
    await prisma.entry.update({
      where: { id: res.body.id },
      data: { status: 'READY' },
    });
    return res.body.id as string;
  };
  const confirm = (date: string, finalContent: string) =>
    server()
      .post(`/api/v1/entries/${date}/confirm`)
      .set('Authorization', bearer())
      .send({ finalContent })
      .expect(200);
  const statusOf = async (id: string) =>
    prisma.entry.findUniqueOrThrow({
      where: { id },
      select: { aiIndexStatus: true, aiIndexError: true, aiIndexedAt: true },
    });

  it('확정하면 응답은 PENDING, 뒤에서 색인되어 INDEXED', async () => {
    const id = await ready('2026-02-01');
    const res = await confirm('2026-02-01', '확정본');
    expect(res.body.aiIndexStatus).toBe('PENDING');

    await sync.waitForIdle();
    expect(await statusOf(id)).toMatchObject({
      aiIndexStatus: 'INDEXED',
      aiIndexError: null,
      aiIndexedAt: expect.any(Date),
    });
    expect(ai.indexRequests).toEqual([
      {
        user_id: me.userId,
        diary_id: id,
        diary_date: '2026-02-01',
        content: '확정본',
      },
    ]);
  });

  it('재시도 가능한 실패는 다시 시도해 성공하면 INDEXED', async () => {
    const id = await ready('2026-02-02');
    ai.indexPlan = [indexDown(), indexDown()];
    await confirm('2026-02-02', '본문');
    await sync.waitForIdle();

    expect(ai.calls).toEqual(['index:본문', 'index:본문', 'index:본문']);
    expect((await statusOf(id)).aiIndexStatus).toBe('INDEXED');
  });

  it('재시도를 다 써도 실패하면 FAILED + 원인 코드', async () => {
    const id = await ready('2026-02-03');
    ai.indexPlan = Array.from({ length: 5 }, indexDown);
    await confirm('2026-02-03', '본문');
    await sync.waitForIdle();

    expect(ai.calls).toHaveLength(5); // 최초 1 + 재시도 4
    expect(await statusOf(id)).toMatchObject({
      aiIndexStatus: 'FAILED',
      aiIndexError: 'index_unavailable',
    });
  });

  it('재시도하면 안 되는 실패(422 등)는 한 번만 시도하고 FAILED', async () => {
    const id = await ready('2026-02-04');
    ai.indexPlan = [badRequest()];
    await confirm('2026-02-04', '본문');
    await sync.waitForIdle();

    expect(ai.calls).toHaveLength(1);
    expect(await statusOf(id)).toMatchObject({
      aiIndexStatus: 'FAILED',
      aiIndexError: 'validation_error',
    });
  });

  it('색인 중에 다시 확정하면 끝난 뒤 최신 본문으로 한 번 더 색인한다', async () => {
    const id = await ready('2026-02-05');
    const gate = deferred();
    ai.indexPlan = [gate.promise];
    await confirm('2026-02-05', '처음 본문');
    await confirm('2026-02-05', '고친 본문');
    gate.resolve();
    await sync.waitForIdle();

    expect(ai.calls).toEqual(['index:처음 본문', 'index:고친 본문']);
    expect((await statusOf(id)).aiIndexStatus).toBe('INDEXED');
  });

  it('색인 중에 일기를 지우면 색인이 끝난 뒤 지우고, 색인 삭제가 마지막이다', async () => {
    const id = await ready('2026-02-06');
    const gate = deferred();
    ai.indexPlan = [gate.promise];
    await confirm('2026-02-06', '지울 일기');

    const deleting = server()
      .delete('/api/v1/entries/2026-02-06')
      .set('Authorization', bearer())
      .then((r) => r);
    await new Promise((r) => setTimeout(r, 50));
    expect(ai.calls).toEqual(['index:지울 일기']); // 삭제는 색인을 기다린다

    gate.resolve();
    expect((await deleting).status).toBe(204);
    await sync.waitForIdle();
    expect(ai.calls).toEqual(['index:지울 일기', 'delete']);
    expect(await prisma.entry.findUnique({ where: { id } })).toBeNull();
  });

  it('기억에서 제외된 일기는 색인하지 않는다', async () => {
    const id = await ready('2026-02-07');
    await prisma.entry.update({
      where: { id },
      data: { excludedFromMemory: true },
    });
    await confirm('2026-02-07', '비밀');
    await sync.waitForIdle();
    expect(ai.calls).toEqual([]);
  });

  it('reindex: PENDING·FAILED만 다시 처리, all이면 INDEXED도', async () => {
    const pending = await ready('2026-02-08');
    const failed = await ready('2026-02-09');
    const indexed = await ready('2026-02-10');
    await prisma.entry.updateMany({
      where: { id: { in: [pending, failed, indexed] } },
      data: { status: 'CONFIRMED', finalContent: '본문' },
    });
    await prisma.entry.update({
      where: { id: pending },
      data: { aiIndexStatus: 'PENDING' },
    });
    await prisma.entry.update({
      where: { id: failed },
      data: { aiIndexStatus: 'FAILED' },
    });
    await prisma.entry.update({
      where: { id: indexed },
      data: { aiIndexStatus: 'INDEXED' },
    });

    await sync.reindex();
    const touched = new Set(ai.indexRequests.map((r) => r.diary_id));
    expect(touched.has(pending) && touched.has(failed)).toBe(true);
    expect(touched.has(indexed)).toBe(false);

    ai.indexRequests = [];
    await sync.reindex({ all: true });
    expect(new Set(ai.indexRequests.map((r) => r.diary_id)).has(indexed)).toBe(
      true,
    );
  });
});
