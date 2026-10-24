import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from './../src/prisma/prisma.service.js';
import { createTestApp, uniqueEmail } from './utils/create-app.js';

describe('Auth (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const signup = (body: Record<string, unknown>) =>
    http().post('/api/v1/auth/signup').send(body);

  describe('POST /auth/signup', () => {
    it('가입하면 토큰과 사용자를 돌려주고 passwordHash는 없다', async () => {
      const email = uniqueEmail();
      const res = await signup({
        email,
        password: 'abcd1234',
        nickname: '메아리',
      }).expect(201);

      expect(res.body.accessToken).toEqual(expect.any(String));
      expect(res.body.user).toEqual({
        id: expect.any(String),
        email,
        nickname: '메아리',
        diaryStyle: 'PLAIN',
        createdAt: expect.any(String),
      });
      expect(JSON.stringify(res.body)).not.toContain('password');
    });

    it('기본 체크리스트 6개 카테고리를 함께 만든다', async () => {
      const res = await signup({
        email: uniqueEmail(),
        password: 'abcd1234',
        nickname: '메아리',
      }).expect(201);

      const categories = await prisma.checklistCategory.findMany({
        where: { userId: res.body.user.id },
        include: { items: true },
        orderBy: { sortOrder: 'asc' },
      });
      expect(categories.map((c) => c.name)).toEqual([
        '운동',
        '식사',
        '수면',
        '학습/업무',
        '사람',
        '기분',
      ]);
      expect(categories.every((c) => c.items.length > 0)).toBe(true);
    });

    it('이메일은 소문자로 저장하고, 대소문자만 다른 이메일은 409', async () => {
      const email = uniqueEmail('Case');
      await signup({ email, password: 'abcd1234', nickname: 'a' }).expect(201);

      const res = await signup({
        email: email.toUpperCase(),
        password: 'abcd1234',
        nickname: 'b',
      }).expect(409);
      expect(res.body.error.code).toBe('EMAIL_TAKEN');
    });

    it.each([
      [
        '이메일 형식 아님',
        { email: 'not-email', password: 'abcd1234', nickname: 'a' },
      ],
      [
        '비밀번호 7자',
        { email: uniqueEmail(), password: 'abc1234', nickname: 'a' },
      ],
      [
        '비밀번호에 숫자 없음',
        { email: uniqueEmail(), password: 'abcdefgh', nickname: 'a' },
      ],
      [
        '닉네임 21자',
        {
          email: uniqueEmail(),
          password: 'abcd1234',
          nickname: 'a'.repeat(21),
        },
      ],
      [
        '닉네임 공백만',
        { email: uniqueEmail(), password: 'abcd1234', nickname: '   ' },
      ],
    ])('%s → 400 VALIDATION_FAILED', async (_, body) => {
      const res = await signup(body).expect(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
      expect(res.body.error.details).toEqual(expect.any(Array));
    });

    it('정의되지 않은 필드(userId 등)를 보내면 400', async () => {
      const res = await signup({
        email: uniqueEmail(),
        password: 'abcd1234',
        nickname: 'a',
        diaryStyle: 'EMOTIONAL',
      }).expect(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
    });
  });

  describe('POST /auth/login', () => {
    const email = uniqueEmail('login');

    beforeAll(async () => {
      await signup({ email, password: 'abcd1234', nickname: '로그인' }).expect(
        201,
      );
    });

    it('맞는 비밀번호면 200과 토큰', async () => {
      const res = await http()
        .post('/api/v1/auth/login')
        .send({ email: email.toUpperCase(), password: 'abcd1234' })
        .expect(200);
      expect(res.body.accessToken).toEqual(expect.any(String));
      expect(res.body.user.email).toBe(email);
    });

    it('틀린 비밀번호와 없는 이메일은 같은 401 INVALID_CREDENTIALS', async () => {
      const wrong = await http()
        .post('/api/v1/auth/login')
        .send({ email, password: 'wrong1234' })
        .expect(401);
      const missing = await http()
        .post('/api/v1/auth/login')
        .send({ email: uniqueEmail('none'), password: 'abcd1234' })
        .expect(401);

      expect(wrong.body.error.code).toBe('INVALID_CREDENTIALS');
      expect(missing.body).toEqual(wrong.body);
    });
  });

  describe('GET /me', () => {
    it('토큰이 없으면 401 UNAUTHORIZED', async () => {
      const res = await http().get('/api/v1/me').expect(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('위조된 토큰이면 401', async () => {
      await http()
        .get('/api/v1/me')
        .set('Authorization', 'Bearer not-a-real-token')
        .expect(401);
    });

    it('유효한 토큰이면 내 정보를 돌려주고 passwordHash는 없다', async () => {
      const { body } = await signup({
        email: uniqueEmail(),
        password: 'abcd1234',
        nickname: '나',
      }).expect(201);

      const res = await http()
        .get('/api/v1/me')
        .set('Authorization', `Bearer ${body.accessToken}`)
        .expect(200);
      expect(res.body).toEqual(body.user);
      expect(JSON.stringify(res.body)).not.toContain('password');
    });

    it('탈퇴한 사용자의 토큰은 만료 전이어도 401', async () => {
      const { body } = await signup({
        email: uniqueEmail('gone'),
        password: 'abcd1234',
        nickname: '탈퇴',
      }).expect(201);
      await prisma.user.delete({ where: { id: body.user.id } });

      await http()
        .get('/api/v1/me')
        .set('Authorization', `Bearer ${body.accessToken}`)
        .expect(401);
    });
  });

  describe('공통', () => {
    it('GET /health는 인증 없이 200', async () => {
      await http().get('/health').expect(200, { status: 'ok', db: 'ok' });
    });

    it('없는 경로는 404 NOT_FOUND 에러 형식', async () => {
      const res = await http().get('/api/v1/nope').expect(404);
      expect(res.body).toEqual({
        error: {
          code: 'NOT_FOUND',
          message: expect.any(String),
          details: null,
        },
      });
    });
  });
});
