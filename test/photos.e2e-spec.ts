import type { INestApplication } from '@nestjs/common';
import { readdir, rm } from 'node:fs/promises';
import sharp from 'sharp';
import request from 'supertest';
import { PrismaService } from './../src/prisma/prisma.service.js';
import { createTestApp, signupUser } from './utils/create-app.js';

const jpeg = (color = '#c08060') =>
  sharp({ create: { width: 640, height: 480, channels: 3, background: color } })
    .withExif({ IFD0: { Copyright: 'secret-exif' } })
    .jpeg()
    .toBuffer();

describe('Photos (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let me: { token: string; userId: string };
  let other: { token: string; userId: string };

  beforeAll(async () => {
    await rm('.test-uploads', { recursive: true, force: true });
    app = await createTestApp();
    prisma = app.get(PrismaService);
    me = await signupUser(app, 'photo-me');
    other = await signupUser(app, 'photo-other');
  });

  afterAll(async () => {
    await app.close();
    await rm('.test-uploads', { recursive: true, force: true });
  });

  const server = () => request(app.getHttpServer());
  const auth = (who: { token: string }) => `Bearer ${who.token}`;

  const upload = (
    who: { token: string },
    date: string,
    files: Buffer[],
    captions?: string,
  ) => {
    let req = server()
      .post(`/api/v1/entries/${date}/photos`)
      .set('Authorization', auth(who));
    files.forEach((f, i) => {
      req = req.attach('files', f, {
        filename: `p${i}.jpg`,
        contentType: 'image/jpeg',
      });
    });
    if (captions !== undefined) req = req.field('captions', captions);
    return req;
  };

  // 서명 URL에서 경로만 떼어 테스트 서버로 요청한다
  const fetchUrl = (url: string) => {
    const u = new URL(url);
    return server().get(`${u.pathname}${u.search}`).buffer(true);
  };

  describe('POST (F1)', () => {
    it('일기가 없으면 DRAFT로 만들고 사진을 저장한다', async () => {
      const res = await upload(
        me,
        '2026-06-01',
        [await jpeg(), await jpeg('#336699')],
        '["카페에서", ""]',
      ).expect(201);

      expect(res.body.items).toHaveLength(2);
      expect(res.body.items[0]).toMatchObject({
        caption: '카페에서',
        sortOrder: 0,
        width: 640,
        height: 480,
      });
      expect(res.body.items[1]).toMatchObject({ caption: null, sortOrder: 1 });

      const entry = await server()
        .get('/api/v1/entries/2026-06-01')
        .set('Authorization', auth(me))
        .expect(200);
      expect(entry.body.status).toBe('DRAFT');
      expect(entry.body.photos.map((p: { id: string }) => p.id)).toEqual(
        res.body.items.map((p: { id: string }) => p.id),
      );
    });

    it('서명 URL로 받은 파일은 EXIF가 지워진 JPEG다', async () => {
      const res = await upload(me, '2026-06-02', [await jpeg()]).expect(201);
      const file = await fetchUrl(res.body.items[0].url).expect(200);

      expect(file.headers['content-type']).toBe('image/jpeg');
      expect(file.headers['cache-control']).toMatch(/^private, max-age=\d+$/);
      const meta = await sharp(file.body as Buffer).metadata();
      expect(meta.format).toBe('jpeg');
      expect(meta.exif).toBeUndefined();
    });

    it('서명을 바꾼 URL은 404', async () => {
      const res = await upload(me, '2026-06-03', [await jpeg()]).expect(201);
      const url = new URL(res.body.items[0].url);
      url.searchParams.set('sig', 'x'.repeat(43));
      await fetchUrl(url.toString()).expect(404);
    });

    it('기존 + 새 사진이 3장을 넘으면 422이고 아무것도 저장하지 않는다', async () => {
      await upload(me, '2026-06-04', [await jpeg(), await jpeg()]).expect(201);
      const before = await readdir(
        `.test-uploads/users/${me.userId}/2026-06-04`,
      );

      const res = await upload(me, '2026-06-04', [
        await jpeg(),
        await jpeg(),
      ]).expect(422);
      expect(res.body.error).toMatchObject({
        code: 'PHOTO_LIMIT_EXCEEDED',
        details: { max: 3 },
      });
      expect(
        await readdir(`.test-uploads/users/${me.userId}/2026-06-04`),
      ).toEqual(before);
    });

    it('4MB를 넘는 파일은 413 FILE_TOO_LARGE', async () => {
      const res = await upload(me, '2026-06-05', [
        Buffer.alloc(4 * 1024 * 1024 + 1, 1),
      ]).expect(413);
      expect(res.body.error.code).toBe('FILE_TOO_LARGE');
    });

    it('이미지가 아닌 파일은 MIME이 image/jpeg여도 415', async () => {
      const res = await upload(me, '2026-06-06', [
        Buffer.from('not really a jpeg'),
      ]).expect(415);
      expect(res.body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
      await server()
        .get('/api/v1/entries/2026-06-06')
        .set('Authorization', auth(me))
        .expect(404); // 실패하면 일기도 만들지 않는다
    });

    it('파일 없이 보내거나 캡션 형식이 틀리면 400', async () => {
      await upload(me, '2026-06-07', []).expect(400);
      await upload(me, '2026-06-07', [await jpeg()], 'not-json').expect(400);
      await upload(
        me,
        '2026-06-07',
        [await jpeg()],
        JSON.stringify(['a'.repeat(101)]),
      ).expect(400);
    });

    it('사진이 바뀌면 분석·질문을 지우고 확정 전 일기는 DRAFT로 되돌린다', async () => {
      await upload(me, '2026-06-08', [await jpeg()]).expect(201);
      const entry = await prisma.entry.findFirstOrThrow({
        where: { userId: me.userId, entryDate: new Date('2026-06-08') },
      });
      await prisma.entry.update({
        where: { id: entry.id },
        data: {
          status: 'GENERATED',
          imageAnalysis: { location: null },
          questions: {
            create: {
              aiQuestionId: 'q1',
              question: 'q',
              reason: 'r',
              sortOrder: 0,
            },
          },
        },
      });

      await upload(me, '2026-06-08', [await jpeg()]).expect(201);
      const after = await prisma.entry.findUniqueOrThrow({
        where: { id: entry.id },
        include: { questions: true },
      });
      expect(after.status).toBe('DRAFT');
      expect(after.imageAnalysis).toBeNull();
      expect(after.questions).toEqual([]);
    });

    it('확정된 일기는 사진을 바꿔도 CONFIRMED를 유지한다', async () => {
      await upload(me, '2026-06-09', [await jpeg()]).expect(201);
      await prisma.entry.updateMany({
        where: { userId: me.userId, entryDate: new Date('2026-06-09') },
        data: { status: 'CONFIRMED', finalContent: '확정본' },
      });
      await upload(me, '2026-06-09', [await jpeg()]).expect(201);
      const after = await prisma.entry.findFirstOrThrow({
        where: { userId: me.userId, entryDate: new Date('2026-06-09') },
      });
      expect(after.status).toBe('CONFIRMED');
    });
  });

  describe('PATCH·DELETE (F2·F3)', () => {
    it('순서를 바꾸면 나머지가 밀리고, 캡션을 비우면 null', async () => {
      const res = await upload(
        me,
        '2026-06-10',
        [await jpeg(), await jpeg(), await jpeg()],
        '["a","b","c"]',
      ).expect(201);
      const [a, b, c] = res.body.items.map((p: { id: string }) => p.id);

      const moved = await server()
        .patch(`/api/v1/entries/2026-06-10/photos/${c}`)
        .set('Authorization', auth(me))
        .send({ sortOrder: 0, caption: '  ' })
        .expect(200);
      expect(moved.body).toMatchObject({ sortOrder: 0, caption: null });

      const entry = await server()
        .get('/api/v1/entries/2026-06-10')
        .set('Authorization', auth(me))
        .expect(200);
      expect(entry.body.photos.map((p: { id: string }) => p.id)).toEqual([
        c,
        a,
        b,
      ]);
    });

    it('삭제하면 파일도 지우고 순서를 다시 매긴다', async () => {
      const res = await upload(me, '2026-06-11', [
        await jpeg(),
        await jpeg(),
      ]).expect(201);
      const [first, second] = res.body.items;

      await server()
        .delete(`/api/v1/entries/2026-06-11/photos/${first.id}`)
        .set('Authorization', auth(me))
        .expect(204);
      await fetchUrl(first.url).expect(404);

      const entry = await server()
        .get('/api/v1/entries/2026-06-11')
        .set('Authorization', auth(me))
        .expect(200);
      expect(entry.body.photos).toEqual([
        expect.objectContaining({ id: second.id, sortOrder: 0 }),
      ]);
    });

    it('남의 사진은 수정·삭제할 수 없다 (404)', async () => {
      const res = await upload(other, '2026-06-12', [await jpeg()]).expect(201);
      const theirs = res.body.items[0].id;

      await server()
        .patch(`/api/v1/entries/2026-06-12/photos/${theirs}`)
        .set('Authorization', auth(me))
        .send({ caption: 'hack' })
        .expect(404);
      await server()
        .delete(`/api/v1/entries/2026-06-12/photos/${theirs}`)
        .set('Authorization', auth(me))
        .expect(404);
      await fetchUrl(res.body.items[0].url).expect(200);
    });

    it('날짜가 다르면 같은 사진 ID라도 404', async () => {
      const res = await upload(me, '2026-06-13', [await jpeg()]).expect(201);
      await server()
        .delete(`/api/v1/entries/2026-06-14/photos/${res.body.items[0].id}`)
        .set('Authorization', auth(me))
        .expect(404);
    });
  });

  it('일기를 지우면 사진 파일도 지워진다', async () => {
    const res = await upload(me, '2026-06-15', [await jpeg()]).expect(201);
    await server()
      .delete('/api/v1/entries/2026-06-15')
      .set('Authorization', auth(me))
      .expect(204);
    await fetchUrl(res.body.items[0].url).expect(404);
  });
});
