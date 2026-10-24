import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { todayKst } from './../src/common/pipes/parse-date.pipe.js';
import { createTestApp, uniqueEmail } from './utils/create-app.js';

// 공통 입력 검증(날짜·길이)
describe('Input validation (e2e)', () => {
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

  it('미래 날짜는 422 DATE_IN_FUTURE', async () => {
    const res = await get(`/api/v1/entries/${tomorrow()}`).expect(422);
    expect(res.body.error.code).toBe('DATE_IN_FUTURE');
  });

  it('잘못된 날짜 형식은 400', async () => {
    const res = await get('/api/v1/entries/2026-02-30').expect(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
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
