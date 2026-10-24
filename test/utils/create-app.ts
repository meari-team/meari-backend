import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModuleBuilder } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from './../../src/app.module.js';
import { configureApp } from './../../src/app.setup.js';

export async function createTestApp(
  override?: (builder: TestingModuleBuilder) => TestingModuleBuilder,
): Promise<INestApplication> {
  const builder = Test.createTestingModule({ imports: [AppModule] });
  const moduleRef = await (override ? override(builder) : builder).compile();
  const app = configureApp(moduleRef.createNestApplication());
  await app.init();
  return app;
}

let seq = 0;
export const uniqueEmail = (prefix = 'user') =>
  `${prefix}-${Date.now()}-${seq++}@test.meari`;

// 가입한 뒤 토큰과 사용자 ID를 돌려준다
export async function signupUser(app: INestApplication, prefix = 'user') {
  const res = await request(app.getHttpServer())
    .post('/api/v1/auth/signup')
    .send({
      email: uniqueEmail(prefix),
      password: 'abcd1234',
      nickname: prefix,
    })
    .expect(201);
  return {
    token: res.body.accessToken as string,
    userId: res.body.user.id as string,
  };
}
