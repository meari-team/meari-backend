import type { INestApplication } from '@nestjs/common';
import { readdir, rm } from 'node:fs/promises';
import sharp from 'sharp';
import request from 'supertest';
import { AiClientError } from './../src/ai-client/ai-client.error.js';
import { AiClient } from './../src/ai-client/ai-client.service.js';
import { MemorySyncService } from './../src/memory-sync/memory-sync.service.js';
import { PrismaService } from './../src/prisma/prisma.service.js';
import { createTestApp, signupUser } from './utils/create-app.js';

// AI 서버 대역 (vi.fn 대신 직접 — entries.e2e-spec.ts 메모 참고)
const ai = {
  deleted: [] as string[],
  failOnCall: 0, // n번째 삭제 호출에서 실패 (0이면 실패 안 함)
  deleteDiaryIndex(userId: string, diaryId: string) {
    if (this.failOnCall && this.deleted.length + 1 === this.failOnCall) {
      return Promise.reject(
        new AiClientError(
          'AI_INDEX_UNAVAILABLE',
          503,
          '기억 저장소에 연결할 수 없어요.',
          { type: 'network' },
          true,
        ),
      );
    }
    this.deleted.push(diaryId);
    return Promise.resolve({
      user_id: userId,
      diary_id: diaryId,
      indexed: false,
    });
  },
  indexDiary: () => Promise.resolve({ indexed: true }),
};

describe('Withdraw (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp((b) => b.overrideProvider(AiClient).useValue(ai));
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.get(MemorySyncService).waitForIdle();
    await app.close();
    await rm('.test-uploads', { recursive: true, force: true });
  });

  beforeEach(() => {
    ai.deleted = [];
    ai.failOnCall = 0;
  });

  const server = () => request(app.getHttpServer());

  // 확정 2편(그중 1편 사진), 작성 중 1편, 채팅 세션 1개
  const seed = async (prefix: string) => {
    const who = await signupUser(app, prefix);
    const mk = (date: string, status: 'CONFIRMED' | 'DRAFT') =>
      prisma.entry.create({
        data: {
          userId: who.userId,
          entryDate: new Date(`${date}T00:00:00Z`),
          status,
          finalContent: status === 'CONFIRMED' ? '본문' : null,
          aiIndexStatus: status === 'CONFIRMED' ? 'INDEXED' : 'NONE',
        },
      });
    const a = await mk('2026-01-01', 'CONFIRMED');
    const b = await mk('2026-01-02', 'CONFIRMED');
    await mk('2026-01-03', 'DRAFT');
    const img = await sharp({
      create: { width: 16, height: 16, channels: 3, background: '#999' },
    })
      .jpeg()
      .toBuffer();
    await server()
      .post('/api/v1/entries/2026-01-01/photos')
      .set('Authorization', `Bearer ${who.token}`)
      .attach('files', img, { filename: 'a.jpg', contentType: 'image/jpeg' })
      .expect(201);
    await prisma.chatSession.create({
      data: {
        userId: who.userId,
        anchorDate: new Date('2026-01-02T00:00:00Z'),
      },
    });
    return { ...who, confirmed: [a.id, b.id] };
  };

  it('AI 기억을 모두 지운 뒤 사용자·일기·사진·채팅을 지우고, 토큰은 401이 된다', async () => {
    const who = await seed('bye');
    await server()
      .delete('/api/v1/me')
      .set('Authorization', `Bearer ${who.token}`)
      .expect(204);

    expect(ai.deleted.sort()).toEqual([...who.confirmed].sort());
    expect(
      await prisma.user.findUnique({ where: { id: who.userId } }),
    ).toBeNull();
    expect(await prisma.entry.count({ where: { userId: who.userId } })).toBe(0);
    expect(
      await prisma.chatSession.count({ where: { userId: who.userId } }),
    ).toBe(0);
    expect(
      await prisma.checklistCategory.count({ where: { userId: who.userId } }),
    ).toBe(0);
    const files = await readdir(
      `.test-uploads/users/${who.userId}/2026-01-01`,
    ).catch(() => []);
    expect(files).toEqual([]);

    await server()
      .get('/api/v1/me')
      .set('Authorization', `Bearer ${who.token}`)
      .expect(401);
  });

  it('AI 삭제가 하나라도 실패하면 503이고 아무것도 지우지 않는다 (지운 기억은 다시 색인 대기)', async () => {
    const who = await seed('stay');
    ai.failOnCall = 2;
    const res = await server()
      .delete('/api/v1/me')
      .set('Authorization', `Bearer ${who.token}`)
      .expect(503);
    expect(res.body.error.code).toBe('AI_INDEX_UNAVAILABLE');

    expect(await prisma.entry.count({ where: { userId: who.userId } })).toBe(3);
    const firstRemoved = ai.deleted[0];
    const restored = await prisma.entry.findUniqueOrThrow({
      where: { id: firstRemoved },
    });
    expect(['PENDING', 'INDEXED']).toContain(restored.aiIndexStatus);
    await server()
      .get('/api/v1/me')
      .set('Authorization', `Bearer ${who.token}`)
      .expect(200);
  });

  it('다른 사용자의 데이터는 그대로', async () => {
    const keep = await seed('keep');
    const leave = await signupUser(app, 'leave');
    await server()
      .delete('/api/v1/me')
      .set('Authorization', `Bearer ${leave.token}`)
      .expect(204);
    expect(await prisma.entry.count({ where: { userId: keep.userId } })).toBe(
      3,
    );
    expect(ai.deleted).toEqual([]);
  });
});
