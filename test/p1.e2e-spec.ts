import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AiClientError } from './../src/ai-client/ai-client.error.js';
import { AiClient } from './../src/ai-client/ai-client.service.js';
import type { IndexDiaryRequest } from './../src/ai-client/ai-client.types.js';
import { MemorySyncService } from './../src/memory-sync/memory-sync.service.js';
import { PrismaService } from './../src/prisma/prisma.service.js';
import { createTestApp, signupUser } from './utils/create-app.js';

// AI 서버 대역 (vi.fn 대신 직접 — entries.e2e-spec.ts 메모 참고)
const ai = {
  calls: [] as string[],
  deleteFails: false,
  deleteDiaryIndex(userId: string, diaryId: string) {
    this.calls.push(`delete:${diaryId}`);
    return this.deleteFails
      ? Promise.reject(
          new AiClientError(
            'AI_INDEX_UNAVAILABLE',
            503,
            '기억 저장소에 연결할 수 없어요.',
            { type: 'network' },
            true,
          ),
        )
      : Promise.resolve({ user_id: userId, diary_id: diaryId, indexed: false });
  },
  indexDiary(req: IndexDiaryRequest) {
    this.calls.push(`index:${req.diary_id}`);
    return Promise.resolve({
      user_id: req.user_id,
      diary_id: req.diary_id,
      indexed: true,
    });
  },
};

describe('P1: 내 정보·체크리스트 편집·기억에서 제외 (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let sync: MemorySyncService;
  let me: { token: string; userId: string };
  let other: { token: string; userId: string };

  beforeAll(async () => {
    app = await createTestApp((b) => b.overrideProvider(AiClient).useValue(ai));
    prisma = app.get(PrismaService);
    sync = app.get(MemorySyncService);
    me = await signupUser(app, 'p1');
    other = await signupUser(app, 'p1-other');
  });

  afterAll(async () => {
    await sync.waitForIdle();
    await app.close();
  });

  beforeEach(() => {
    ai.calls = [];
    ai.deleteFails = false;
  });

  const as = (who: { token: string }) => {
    const auth = (r: request.Test) =>
      r.set('Authorization', `Bearer ${who.token}`);
    const s = () => request(app.getHttpServer());
    return {
      get: (p: string) => auth(s().get(p)),
      post: (p: string, b: object) => auth(s().post(p).send(b)),
      put: (p: string, b: object) => auth(s().put(p).send(b)),
      patch: (p: string, b: object) => auth(s().patch(p).send(b)),
      del: (p: string) => auth(s().delete(p)),
    };
  };

  describe('PATCH /me (U2)', () => {
    it('보낸 필드만 바꾸고 스텁 헤더가 없다', async () => {
      const res = await as(me)
        .patch('/api/v1/me', { nickname: '  새 이름 ' })
        .expect(200);
      expect(res.headers['x-meari-stub']).toBeUndefined();
      expect(res.body).toMatchObject({
        nickname: '새 이름',
        diaryStyle: 'PLAIN',
      });

      const styled = await as(me)
        .patch('/api/v1/me', { diaryStyle: 'EMOTIONAL' })
        .expect(200);
      expect(styled.body).toMatchObject({
        nickname: '새 이름',
        diaryStyle: 'EMOTIONAL',
      });
      expect((await as(me).get('/api/v1/me').expect(200)).body.diaryStyle).toBe(
        'EMOTIONAL',
      );
    });

    it('잘못된 문체·빈 닉네임·이메일 변경 시도는 400', async () => {
      await as(me).patch('/api/v1/me', { diaryStyle: 'FUNNY' }).expect(400);
      await as(me).patch('/api/v1/me', { nickname: '   ' }).expect(400);
      await as(me).patch('/api/v1/me', { email: 'x@y.z' }).expect(400);
    });
  });

  describe('체크리스트 편집 (C2~C4)', () => {
    it('추가하면 맨 뒤에 붙고, 색은 대문자로 저장', async () => {
      const res = await as(me)
        .post('/api/v1/checklist/categories', {
          name: '독서',
          color: '#a1b2c3',
          items: ['소설', '전공서'],
        })
        .expect(201);
      expect(res.body).toMatchObject({
        name: '독서',
        color: '#A1B2C3',
        sortOrder: 6,
      });
      expect(res.body.items.map((i: { label: string }) => i.label)).toEqual([
        '소설',
        '전공서',
      ]);
    });

    it('항목 전체 교체: id 있는 항목은 유지(과거 체크 보존), 빠진 항목과 그 체크는 삭제, 새 항목 추가', async () => {
      const created = await as(me)
        .post('/api/v1/checklist/categories', {
          name: '취미',
          color: '#112233',
          items: ['그림', '기타', '요리'],
        })
        .expect(201);
      const [draw, guitar] = created.body.items;
      const entry = await as(me)
        .put('/api/v1/entries/2026-07-20', {
          checkedItemIds: [draw.id, guitar.id],
        })
        .expect(201);

      const res = await as(me)
        .patch(`/api/v1/checklist/categories/${created.body.id}`, {
          name: '취미생활',
          items: [{ label: '새 항목' }, { id: draw.id, label: '드로잉' }],
        })
        .expect(200);
      expect(res.body.name).toBe('취미생활');
      expect(res.body.items).toEqual([
        { id: expect.any(String), label: '새 항목', sortOrder: 0 },
        { id: draw.id, label: '드로잉', sortOrder: 1 },
      ]);

      const after = await as(me).get('/api/v1/entries/2026-07-20').expect(200);
      expect(after.body.checkedItemIds).toEqual([draw.id]); // 기타 체크는 사라지고 그림(드로잉)은 남음
      expect(after.body.id).toBe(entry.body.id);
    });

    it('다른 카테고리·남의 항목 id나 중복 id로 교체하면 400', async () => {
      const mine = (await as(me).get('/api/v1/checklist/categories')).body
        .items;
      const theirs = (await as(other).get('/api/v1/checklist/categories')).body
        .items;
      const target = mine[0].id;
      await as(me)
        .patch(`/api/v1/checklist/categories/${target}`, {
          items: [{ id: mine[1].items[0].id, label: 'x' }],
        })
        .expect(400);
      await as(me)
        .patch(`/api/v1/checklist/categories/${target}`, {
          items: [{ id: theirs[0].items[0].id, label: 'x' }],
        })
        .expect(400);
      const keep = mine[0].items[0].id;
      await as(me)
        .patch(`/api/v1/checklist/categories/${target}`, {
          items: [
            { id: keep, label: 'a' },
            { id: keep, label: 'b' },
          ],
        })
        .expect(400);
    });

    it('삭제하면 항목과 과거 체크도 사라진다. 남의 카테고리는 404', async () => {
      const created = await as(me)
        .post('/api/v1/checklist/categories', {
          name: '임시',
          color: '#000000',
          items: ['하나'],
        })
        .expect(201);
      await as(me)
        .put('/api/v1/entries/2026-07-21', {
          checkedItemIds: [created.body.items[0].id],
        })
        .expect(201);

      const theirs = (await as(other).get('/api/v1/checklist/categories')).body
        .items[0].id;
      const res = await as(me)
        .del(`/api/v1/checklist/categories/${theirs}`)
        .expect(404);
      expect(res.body.error.code).toBe('CATEGORY_NOT_FOUND');
      await as(me)
        .patch(`/api/v1/checklist/categories/${theirs}`, { name: 'x' })
        .expect(404);

      await as(me)
        .del(`/api/v1/checklist/categories/${created.body.id}`)
        .expect(204);
      expect(
        (await as(me).get('/api/v1/entries/2026-07-21')).body.checkedItemIds,
      ).toEqual([]);
      expect(
        (await as(other).get('/api/v1/checklist/categories')).body.items,
      ).toHaveLength(6);
    });

    it('색 형식이 틀리거나 항목 10개 초과면 400', async () => {
      await as(me)
        .post('/api/v1/checklist/categories', {
          name: 'a',
          color: 'red',
          items: [],
        })
        .expect(400);
      await as(me)
        .post('/api/v1/checklist/categories', {
          name: 'a',
          color: '#000000',
          items: Array.from({ length: 11 }, (_, i) => `${i}`),
        })
        .expect(400);
    });
  });

  describe('PATCH /entries/:date/memory (G5)', () => {
    const confirmed = async (date: string) =>
      (
        await prisma.entry.create({
          data: {
            userId: me.userId,
            entryDate: new Date(`${date}T00:00:00Z`),
            status: 'CONFIRMED',
            finalContent: '본문',
            aiIndexStatus: 'INDEXED',
          },
        })
      ).id;

    it('제외하면 AI 기억을 먼저 지우고 excluded·NONE, 복원하면 PENDING 후 다시 색인', async () => {
      const id = await confirmed('2026-07-01');
      const off = await as(me)
        .patch('/api/v1/entries/2026-07-01/memory', { excluded: true })
        .expect(200);
      expect(off.body).toMatchObject({
        excludedFromMemory: true,
        aiIndexStatus: 'NONE',
      });
      expect(ai.calls).toEqual([`delete:${id}`]);

      const on = await as(me)
        .patch('/api/v1/entries/2026-07-01/memory', { excluded: false })
        .expect(200);
      expect(on.body).toMatchObject({
        excludedFromMemory: false,
        aiIndexStatus: 'PENDING',
      });
      await sync.waitForIdle();
      expect(ai.calls).toEqual([`delete:${id}`, `index:${id}`]);
      expect(
        (await prisma.entry.findUniqueOrThrow({ where: { id } })).aiIndexStatus,
      ).toBe('INDEXED');
    });

    it('AI 삭제가 실패하면 503이고 제외되지 않는다', async () => {
      const id = await confirmed('2026-07-02');
      ai.deleteFails = true;
      const res = await as(me)
        .patch('/api/v1/entries/2026-07-02/memory', { excluded: true })
        .expect(503);
      expect(res.body.error.code).toBe('AI_INDEX_UNAVAILABLE');
      expect(
        await prisma.entry.findUniqueOrThrow({ where: { id } }),
      ).toMatchObject({ excludedFromMemory: false, aiIndexStatus: 'INDEXED' });
    });

    it('확정 전 일기는 409, 없거나 남의 일기는 404', async () => {
      await as(me).put('/api/v1/entries/2026-07-03', {}).expect(201);
      await as(me)
        .patch('/api/v1/entries/2026-07-03/memory', { excluded: true })
        .expect(409);
      await as(other)
        .patch('/api/v1/entries/2026-07-01/memory', { excluded: true })
        .expect(404);
    });
  });
});
