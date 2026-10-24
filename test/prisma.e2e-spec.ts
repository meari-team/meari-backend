import { PrismaService } from './../src/prisma/prisma.service.js';

// 마이그레이션이 적용된 DB(DATABASE_URL)가 필요하다.
describe('Prisma schema (e2e)', () => {
  const prisma = new PrismaService();

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('메인 DB 테이블이 모두 있다', async () => {
    const rows = await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public'`;
    const tables = rows.map((r) => r.tablename);

    expect(tables).toEqual(
      expect.arrayContaining([
        'users',
        'entries',
        'photos',
        'entry_questions',
        'checklist_categories',
        'checklist_items',
        'entry_checks',
        'chat_sessions',
        'chat_messages',
      ]),
    );
  });

  it('회원을 지우면 일기·사진·채팅이 함께 지워진다 (ADR-006 하드 삭제)', async () => {
    const user = await prisma.user.create({
      data: {
        email: `cascade-${Date.now()}@test.meari`,
        passwordHash: 'x',
        nickname: '테스트',
        entries: {
          create: { entryDate: new Date('2026-10-01') },
        },
        chatSessions: {
          create: {
            anchorDate: new Date('2026-09-30'),
            messages: { create: { role: 'USER', content: '안녕' } },
          },
        },
      },
      include: { entries: true },
    });
    await prisma.photo.create({
      data: {
        entryId: user.entries[0].id,
        userId: user.id,
        storageKey: 'test.jpg',
        sortOrder: 0,
      },
    });

    await prisma.user.delete({ where: { id: user.id } });

    expect(await prisma.entry.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.photo.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.chatSession.count({ where: { userId: user.id } })).toBe(
      0,
    );
  });

  it('같은 사용자는 같은 날짜에 일기를 하나만 가진다', async () => {
    const user = await prisma.user.create({
      data: {
        email: `unique-${Date.now()}@test.meari`,
        passwordHash: 'x',
        nickname: '테스트',
      },
    });
    const entryDate = new Date('2026-10-02');

    await prisma.entry.create({ data: { userId: user.id, entryDate } });
    await expect(
      prisma.entry.create({ data: { userId: user.id, entryDate } }),
    ).rejects.toThrow();

    await prisma.user.delete({ where: { id: user.id } });
  });
});
