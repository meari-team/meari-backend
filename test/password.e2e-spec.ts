import type { INestApplication } from '@nestjs/common';
import { hash } from 'bcryptjs';
import request from 'supertest';
import { PrismaService } from './../src/prisma/prisma.service.js';
import { createTestApp, uniqueEmail } from './utils/create-app.js';

describe('비밀번호 변경 (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  const server = () => request(app.getHttpServer());

  const signup = async () => {
    const email = uniqueEmail('pw');
    const res = await server()
      .post('/api/v1/auth/signup')
      .send({ email, password: 'abcd1234', nickname: 'pw' })
      .expect(201);
    return {
      email,
      token: res.body.accessToken as string,
      userId: res.body.user.id as string,
    };
  };

  const change = (token: string, body: object) =>
    server()
      .patch('/api/v1/me/password')
      .set('Authorization', `Bearer ${token}`)
      .send(body);

  const login = (email: string, password: string) =>
    server().post('/api/v1/auth/login').send({ email, password });

  it('바꾸면 새 비밀번호로만 로그인되고, 지금 토큰은 그대로 쓸 수 있다', async () => {
    const who = await signup();
    await change(who.token, {
      currentPassword: 'abcd1234',
      newPassword: 'newpass99',
    }).expect(204);

    await login(who.email, 'abcd1234').expect(401);
    await login(who.email, 'newpass99').expect(200);
    await server()
      .get('/api/v1/me')
      .set('Authorization', `Bearer ${who.token}`)
      .expect(200);
  });

  it('지금 비밀번호가 틀리면 400 WRONG_PASSWORD (401 아님)', async () => {
    const who = await signup();
    const res = await change(who.token, {
      currentPassword: 'wrong1234',
      newPassword: 'newpass99',
    }).expect(400);
    expect(res.body.error.code).toBe('WRONG_PASSWORD');
    await login(who.email, 'abcd1234').expect(200);
  });

  it('같은 비밀번호면 SAME_PASSWORD, 규칙에 안 맞으면 VALIDATION_FAILED', async () => {
    const who = await signup();
    const same = await change(who.token, {
      currentPassword: 'abcd1234',
      newPassword: 'abcd1234',
    }).expect(400);
    expect(same.body.error.code).toBe('SAME_PASSWORD');

    const weak = await change(who.token, {
      currentPassword: 'abcd1234',
      newPassword: 'short',
    }).expect(400);
    expect(weak.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('규칙 이전의 짧은 비밀번호에서도 바꿀 수 있다', async () => {
    const who = await signup();
    await app.get(PrismaService).user.update({
      where: { id: who.userId },
      data: { passwordHash: await hash('test', 4) },
    });
    await change(who.token, {
      currentPassword: 'test',
      newPassword: 'newpass99',
    }).expect(204);
    await login(who.email, 'newpass99').expect(200);
  });

  it('로그인하지 않으면 401', async () => {
    await server()
      .patch('/api/v1/me/password')
      .send({ currentPassword: 'abcd1234', newPassword: 'newpass99' })
      .expect(401);
  });
});
