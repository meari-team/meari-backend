import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { todayKst } from './../src/common/pipes/parse-date.pipe.js';
import { createTestApp, uniqueEmail } from './utils/create-app.js';

// MEA-4 스텁: 목 응답이지만 인증·입력 검증은 실제와 같다.
describe('Stub endpoints (e2e)', () => {
  let app: INestApplication;
  let token: string;

  beforeAll(async () => {
    app = await createTestApp();
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send({
        email: uniqueEmail('stub'),
        password: 'abcd1234',
        nickname: '스텁',
      })
      .expect(201);
    token = res.body.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  const get = (path: string) =>
    request(app.getHttpServer())
      .get(path)
      .set('Authorization', `Bearer ${token}`);

  const tomorrow = () => {
    const d = new Date(`${todayKst()}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  };

  it('스텁 응답에는 X-Meari-Stub 헤더가 붙는다', async () => {
    const res = await get('/api/v1/entries/2026-10-01').expect(200);
    expect(res.headers['x-meari-stub']).toBe('true');
    expect(res.body.date).toBe('2026-10-01');
  });

  it('스텁도 토큰이 없으면 401', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/entries/2026-10-01')
      .expect(401);
  });

  it('미래 날짜는 422 DATE_IN_FUTURE', async () => {
    const res = await get(`/api/v1/entries/${tomorrow()}`).expect(422);
    expect(res.body.error.code).toBe('DATE_IN_FUTURE');
  });

  it('잘못된 날짜 형식은 400', async () => {
    const res = await get('/api/v1/entries/2026-02-30').expect(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('캘린더 범위가 366일을 넘으면 400', async () => {
    await get('/api/v1/entries?from=2025-01-01&to=2026-01-02').expect(400);
    await get('/api/v1/entries?from=2026-10-01&to=2026-10-31').expect(200);
  });

  it('프리셋 시점 확인은 5개를 돌려준다', async () => {
    const res = await get('/api/v1/past-self/availability').expect(200);
    expect(res.body.items.map((i: { preset: string }) => i.preset)).toEqual([
      '1W',
      '1M',
      '3M',
      '6M',
      '1Y',
    ]);
  });

  it('미래 시점으로 세션을 만들면 422', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/chat/sessions')
      .set('Authorization', `Bearer ${token}`)
      .send({ anchorDate: tomorrow() })
      .expect(422);
    expect(res.body.error.code).toBe('DATE_IN_FUTURE');
  });

  it('채팅 메시지 500자 초과는 400', async () => {
    await request(app.getHttpServer())
      .post(
        '/api/v1/chat/sessions/00000000-0000-4000-8000-000000000501/messages',
      )
      .set('Authorization', `Bearer ${token}`)
      .send({ content: 'a'.repeat(501) })
      .expect(400);
  });
});
