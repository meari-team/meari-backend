import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from './../src/prisma/prisma.service.js';
import { createTestApp, signupUser } from './utils/create-app.js';

const d = (date: string) => new Date(`${date}T00:00:00Z`);

describe('Entries feed (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let me: { token: string; userId: string };
  let other: { token: string; userId: string };
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    me = await signupUser(app, 'feed');
    other = await signupUser(app, 'feed-other');

    // 내 일기 5편: 2026-03-01 ~ 2026-03-05 (상태·본문 다양하게)
    const rows: [string, object][] = [
      [
        '2026-03-01',
        {
          status: 'CONFIRMED',
          finalContent: '확정\n\n본문   입니다',
          aiDraft: '초안',
          note: '설명',
          aiIndexStatus: 'INDEXED',
        },
      ],
      [
        '2026-03-02',
        { status: 'GENERATED', aiDraft: 'AI 초안 내용', note: '설명' },
      ],
      ['2026-03-03', { status: 'DRAFT', note: '한 줄 설명만' }],
      ['2026-03-04', { status: 'DRAFT' }],
      ['2026-03-05', { status: 'CONFIRMED', finalContent: '가'.repeat(130) }],
    ];
    for (const [date, data] of rows) {
      const e = await prisma.entry.create({
        data: { userId: me.userId, entryDate: d(date), ...data },
      });
      ids[date] = e.id;
    }
    // 사진: 03-01은 2장(대표 사진 = 두 번째), 03-02는 1장(대표 없음 → 첫 사진)
    const p1 = await prisma.photo.create({
      data: {
        entryId: ids['2026-03-01'],
        userId: me.userId,
        storageKey: `users/${me.userId}/2026-03-01/00000000-0000-4000-8000-000000000001.jpg`,
        sortOrder: 0,
      },
    });
    const p2 = await prisma.photo.create({
      data: {
        entryId: ids['2026-03-01'],
        userId: me.userId,
        storageKey: `users/${me.userId}/2026-03-01/00000000-0000-4000-8000-000000000002.jpg`,
        sortOrder: 1,
      },
    });
    await prisma.entry.update({
      where: { id: ids['2026-03-01'] },
      data: { coverPhotoId: p2.id },
    });
    void p1;
    await prisma.photo.create({
      data: {
        entryId: ids['2026-03-02'],
        userId: me.userId,
        storageKey: `users/${me.userId}/2026-03-02/00000000-0000-4000-8000-000000000003.jpg`,
        sortOrder: 0,
      },
    });
    // 체크: 03-01에 운동 항목
    const walk = await prisma.checklistItem.findFirstOrThrow({
      where: { category: { userId: me.userId, name: '운동' } },
      include: { category: true },
    });
    await prisma.entryCheck.create({
      data: { entryId: ids['2026-03-01'], itemId: walk.id },
    });
    // 남의 일기
    await prisma.entry.create({
      data: {
        userId: other.userId,
        entryDate: d('2026-03-03'),
        note: '남의 일기',
      },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  const feed = (q = '') =>
    request(app.getHttpServer())
      .get(`/api/v1/entries/feed${q}`)
      .set('Authorization', `Bearer ${me.token}`);

  it("'feed'가 :date 라우트보다 먼저 매칭된다 (날짜 파이프 400이 아님)", async () => {
    const res = await feed().expect(200);
    expect(res.body).toHaveProperty('items');
    expect(res.body).toHaveProperty('nextBefore');
  });

  it('내 일기만 날짜 내림차순으로, 상태 무관', async () => {
    const res = await feed().expect(200);
    expect(res.body.items.map((i: { date: string }) => i.date)).toEqual([
      '2026-03-05',
      '2026-03-04',
      '2026-03-03',
      '2026-03-02',
      '2026-03-01',
    ]);
    expect(res.body.nextBefore).toBeNull();
  });

  it('limit과 nextBefore로 페이지를 넘기고, before는 그 날짜를 제외한다', async () => {
    const first = await feed('?limit=2').expect(200);
    expect(first.body.items.map((i: { date: string }) => i.date)).toEqual([
      '2026-03-05',
      '2026-03-04',
    ]);
    expect(first.body.nextBefore).toBe('2026-03-04');

    const second = await feed(
      `?limit=2&before=${first.body.nextBefore}`,
    ).expect(200);
    expect(second.body.items.map((i: { date: string }) => i.date)).toEqual([
      '2026-03-03',
      '2026-03-02',
    ]);
    expect(second.body.nextBefore).toBe('2026-03-02');

    const last = await feed(`?limit=2&before=${second.body.nextBefore}`).expect(
      200,
    );
    expect(last.body.items.map((i: { date: string }) => i.date)).toEqual([
      '2026-03-01',
    ]);
    expect(last.body.nextBefore).toBeNull();
  });

  it('항목: 미리보기 우선순위·정리·120자, 대표/첫 사진, 사진 수, 카테고리 색, 색인 상태', async () => {
    const res = await feed().expect(200);
    const by = Object.fromEntries(
      res.body.items.map((i: { date: string }) => [i.date, i]),
    );

    expect(by['2026-03-01']).toMatchObject({
      id: ids['2026-03-01'],
      status: 'CONFIRMED',
      excerpt: '확정 본문 입니다',
      photoCount: 2,
      categoryColors: [expect.stringMatching(/^#[0-9A-Fa-f]{6}$/)],
      aiIndexStatus: 'INDEXED',
    });
    expect(by['2026-03-01'].coverPhotoUrl).toContain(
      Buffer.from(
        `users/${me.userId}/2026-03-01/00000000-0000-4000-8000-000000000002.jpg`,
      ).toString('base64url'),
    );
    expect(by['2026-03-02']).toMatchObject({
      excerpt: 'AI 초안 내용',
      photoCount: 1,
    });
    expect(by['2026-03-02'].coverPhotoUrl).toContain(
      Buffer.from(
        `users/${me.userId}/2026-03-02/00000000-0000-4000-8000-000000000003.jpg`,
      ).toString('base64url'),
    );
    expect(by['2026-03-03']).toMatchObject({
      excerpt: '한 줄 설명만',
      photoCount: 0,
      coverPhotoUrl: null,
      categoryColors: [],
    });
    expect(by['2026-03-04']).toMatchObject({
      excerpt: null,
      aiIndexStatus: 'NONE',
    });
    expect(by['2026-03-05'].excerpt).toBe(`${'가'.repeat(120)}…`);
  });

  it('미래 before는 허용, 잘못된 before·limit은 400', async () => {
    await feed('?before=2099-01-01').expect(200);
    await feed('?before=2026-02-30').expect(400);
    await feed('?before=20260301').expect(400);
    await feed('?limit=0').expect(400);
    await feed('?limit=51').expect(400);
    await feed('?limit=abc').expect(400);
  });

  it('토큰이 없으면 401', async () => {
    await request(app.getHttpServer()).get('/api/v1/entries/feed').expect(401);
  });
});
