import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './utils/create-app.js';

describe('CORS (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('Expo 웹(localhost)의 preflight를 허용한다', async () => {
    const res = await request(app.getHttpServer())
      .options('/api/v1/auth/login')
      .set('Origin', 'http://localhost:8081')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type,authorization')
      .expect(204);
    expect(res.headers['access-control-allow-origin']).toBe(
      'http://localhost:8081',
    );
    expect(res.headers['access-control-allow-headers']).toMatch(
      /Authorization/i,
    );
    expect(res.headers['access-control-allow-credentials']).toBeUndefined();
  });

  it('다른 사이트에는 허용 헤더를 주지 않는다', async () => {
    const res = await request(app.getHttpServer())
      .options('/api/v1/auth/login')
      .set('Origin', 'https://evil.example')
      .set('Access-Control-Request-Method', 'POST');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('실제 응답에도 허용 주소와 Retry-After 노출이 붙는다', async () => {
    const res = await request(app.getHttpServer())
      .get('/health')
      .set('Origin', 'http://127.0.0.1:19006');
    expect(res.headers['access-control-allow-origin']).toBe(
      'http://127.0.0.1:19006',
    );
    expect(res.headers['access-control-expose-headers']).toMatch(/Retry-After/);
  });
});
