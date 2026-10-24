import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AiClientError } from './../src/ai-client/ai-client.error.js';
import { AiClient } from './../src/ai-client/ai-client.service.js';
import { PrismaService } from './../src/prisma/prisma.service.js';
import { createTestApp, signupUser } from './utils/create-app.js';

describe('Entries & Checklist (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  // AI 서버 대역. vi.fn으로 거부된 Promise를 돌려주면 vitest가 테스트 실패로 잡아서 직접 만든다.
  const ai = {
    deleteCalls: [] as [string, string][],
    deleteError: null as Error | null,
    deleteDiaryIndex(userId: string, diaryId: string) {
      this.deleteCalls.push([userId, diaryId]);
      return this.deleteError
        ? Promise.reject(this.deleteError)
        : Promise.resolve({
            user_id: userId,
            diary_id: diaryId,
            indexed: false,
          });
    },
  };

  let me: { token: string; userId: string };
  let other: { token: string; userId: string };

  beforeAll(async () => {
    app = await createTestApp((b) => b.overrideProvider(AiClient).useValue(ai));
    prisma = app.get(PrismaService);
    me = await signupUser(app, 'me');
    other = await signupUser(app, 'other');
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    ai.deleteCalls = [];
    ai.deleteError = null;
  });

  const as = (who: { token: string }) => {
    const auth = (r: request.Test) =>
      r.set('Authorization', `Bearer ${who.token}`);
    const server = () => request(app.getHttpServer());
    return {
      get: (p: string) => auth(server().get(p)),
      put: (p: string, body: object) => auth(server().put(p).send(body)),
      del: (p: string) => auth(server().delete(p)),
    };
  };

  const itemIdsOf = async (who: { token: string }) => {
    const res = await as(who).get('/api/v1/checklist/categories').expect(200);
    return res.body.items.flatMap((c: { items: { id: string }[] }) =>
      c.items.map((i) => i.id),
    ) as string[];
  };

  describe('GET /checklist/categories (C1)', () => {
    it('내 기본 체크리스트 6개를 정렬해서 돌려주고, 스텁 헤더가 없다', async () => {
      const res = await as(me).get('/api/v1/checklist/categories').expect(200);
      expect(res.headers['x-meari-stub']).toBeUndefined();
      expect(res.body.items.map((c: { name: string }) => c.name)).toEqual([
        '운동',
        '식사',
        '수면',
        '학습/업무',
        '사람',
        '기분',
      ]);
      expect(res.body.items[0].items[0]).toEqual({
        id: expect.any(String),
        label: '걷기',
        sortOrder: 0,
      });
    });

    it('다른 사용자의 항목은 섞이지 않는다', async () => {
      const mine = await itemIdsOf(me);
      const theirs = await itemIdsOf(other);
      expect(mine.filter((id) => theirs.includes(id))).toEqual([]);
    });
  });

  describe('PUT /entries/:date (E3)', () => {
    it('처음이면 201 DRAFT, 다시 저장하면 200', async () => {
      const [a, b] = await itemIdsOf(me);
      const created = await as(me)
        .put('/api/v1/entries/2026-10-01', {
          note: '첫 기록',
          checkedItemIds: [a, b],
        })
        .expect(201);
      expect(created.body).toMatchObject({
        date: '2026-10-01',
        status: 'DRAFT',
        note: '첫 기록',
        photos: [],
        questions: [],
        aiUncertain: [],
        aiIndexStatus: 'NONE',
      });
      expect(created.body.checkedItemIds.sort()).toEqual([a, b].sort());

      const updated = await as(me)
        .put('/api/v1/entries/2026-10-01', { checkedItemIds: [b] })
        .expect(200);
      expect(updated.body.id).toBe(created.body.id);
      expect(updated.body.note).toBe('첫 기록'); // 생략하면 유지
      expect(updated.body.checkedItemIds).toEqual([b]); // 보내면 전체 교체
    });

    it('note: null이면 지운다', async () => {
      await as(me)
        .put('/api/v1/entries/2026-10-02', { note: '지울 말' })
        .expect(201);
      const res = await as(me)
        .put('/api/v1/entries/2026-10-02', { note: null })
        .expect(200);
      expect(res.body.note).toBeNull();
    });

    it('다른 사람의 체크리스트 항목은 400', async () => {
      const [theirs] = await itemIdsOf(other);
      const res = await as(me)
        .put('/api/v1/entries/2026-10-03', { checkedItemIds: [theirs] })
        .expect(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
      expect(
        await prisma.entry.count({
          where: { userId: me.userId, entryDate: new Date('2026-10-03') },
        }),
      ).toBe(0);
    });

    it('note 200자 초과·body의 userId는 400', async () => {
      await as(me)
        .put('/api/v1/entries/2026-10-04', { note: 'a'.repeat(201) })
        .expect(400);
      await as(me)
        .put('/api/v1/entries/2026-10-04', { userId: other.userId })
        .expect(400);
    });

    it('같은 날짜라도 사용자별로 따로 저장된다', async () => {
      await as(other)
        .put('/api/v1/entries/2026-10-01', { note: '남의 기록' })
        .expect(201);
      const mine = await as(me).get('/api/v1/entries/2026-10-01').expect(200);
      expect(mine.body.note).toBe('첫 기록');
    });
  });

  describe('GET /entries/:date (E2)', () => {
    it('없는 날짜는 404 ENTRY_NOT_FOUND', async () => {
      const res = await as(me).get('/api/v1/entries/2020-01-01').expect(404);
      expect(res.body.error.code).toBe('ENTRY_NOT_FOUND');
    });

    it('남의 일기만 있는 날짜도 404', async () => {
      await as(other)
        .put('/api/v1/entries/2026-09-15', { note: '비밀' })
        .expect(201);
      await as(me).get('/api/v1/entries/2026-09-15').expect(404);
    });
  });

  describe('GET /entries?from&to (E1)', () => {
    it('기간 안의 내 일기만 날짜순으로, 체크한 카테고리 색과 함께', async () => {
      const categories = (await as(me).get('/api/v1/checklist/categories')).body
        .items;
      const walk = categories[0].items[0].id; // 운동
      const meal = categories[1].items[0].id; // 식사
      await as(me)
        .put('/api/v1/entries/2026-08-10', { checkedItemIds: [walk, meal] })
        .expect(201);
      await as(me).put('/api/v1/entries/2026-08-05', {}).expect(201);
      await as(me).put('/api/v1/entries/2026-09-01', {}).expect(201); // 범위 밖
      await as(other).put('/api/v1/entries/2026-08-07', {}).expect(201); // 남의 것

      const res = await as(me)
        .get('/api/v1/entries?from=2026-08-01&to=2026-08-31')
        .expect(200);
      expect(res.body.items.map((e: { date: string }) => e.date)).toEqual([
        '2026-08-05',
        '2026-08-10',
      ]);
      expect(res.body.items[1]).toMatchObject({
        status: 'DRAFT',
        coverPhotoUrl: null,
        categoryColors: [categories[0].color, categories[1].color],
      });
    });

    it('from > to 또는 366일 이상은 400', async () => {
      await as(me)
        .get('/api/v1/entries?from=2026-08-31&to=2026-08-01')
        .expect(400);
      await as(me)
        .get('/api/v1/entries?from=2025-01-01&to=2026-01-02')
        .expect(400);
      await as(me)
        .get('/api/v1/entries?from=2025-01-01&to=2025-12-31')
        .expect(200);
    });
  });

  describe('DELETE /entries/:date (E4)', () => {
    it('색인 전 일기는 AI 호출 없이 바로 삭제', async () => {
      await as(me).put('/api/v1/entries/2026-07-01', {}).expect(201);
      await as(me).del('/api/v1/entries/2026-07-01').expect(204);
      await as(me).get('/api/v1/entries/2026-07-01').expect(404);
      expect(ai.deleteCalls).toEqual([]);
    });

    it('색인된 일기는 AI 색인을 먼저 지운다', async () => {
      const { body } = await as(me)
        .put('/api/v1/entries/2026-07-02', {})
        .expect(201);
      await prisma.entry.update({
        where: { id: body.id },
        data: { aiIndexStatus: 'INDEXED' },
      });

      await as(me).del('/api/v1/entries/2026-07-02').expect(204);
      expect(ai.deleteCalls).toEqual([[me.userId, body.id]]);
    });

    it('AI 색인 삭제가 실패하면 503이고 일기는 남는다', async () => {
      const { body } = await as(me)
        .put('/api/v1/entries/2026-07-03', {})
        .expect(201);
      await prisma.entry.update({
        where: { id: body.id },
        data: { aiIndexStatus: 'INDEXED' },
      });
      ai.deleteError = new AiClientError(
        'AI_INDEX_UNAVAILABLE',
        503,
        '기억 저장소에 연결할 수 없어요.',
        { type: 'network' },
        true,
      );

      const res = await as(me).del('/api/v1/entries/2026-07-03').expect(503);
      expect(res.body.error.code).toBe('AI_INDEX_UNAVAILABLE');
      await as(me).get('/api/v1/entries/2026-07-03').expect(200);
    });

    it('남의 일기는 지울 수 없다 (404)', async () => {
      await as(other).put('/api/v1/entries/2026-07-04', {}).expect(201);
      await as(me).del('/api/v1/entries/2026-07-04').expect(404);
      await as(other).get('/api/v1/entries/2026-07-04').expect(200);
    });
  });
});
