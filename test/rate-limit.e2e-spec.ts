import type { INestApplication } from '@nestjs/common';
import request from 'supertest';

// ConfigModule(validate)은 앱 모듈을 불러오는 순간의 환경변수를 고정한다.
// 그래서 한도를 먼저 바꾸고 앱 관련 모듈은 동적으로 불러온다 (vitest는 파일마다 모듈을 따로 불러온다).
process.env.RATE_LIMIT_AUTH_PER_MIN = '3';
process.env.RATE_LIMIT_AI_PER_DAY = '2';
process.env.RATE_LIMIT_CHAT_PER_HOUR = '2';
const { createTestApp, signupUser, uniqueEmail } =
  await import('./utils/create-app.js');

// 한도를 작게 바꿔 실제로 막히는지 확인한다 (다른 e2e는 vitest.config.e2e.ts에서 한도를 크게 둔다)
describe('Rate limit (e2e)', () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  const server = () => request(app.getHttpServer());

  it('로그인은 IP당 분당 한도를 넘으면 429 + Retry-After', async () => {
    const login = () =>
      server()
        .post('/api/v1/auth/login')
        .send({ email: uniqueEmail('rl'), password: 'abcd1234' });
    for (let i = 0; i < 3; i++) await login().expect(401);

    const res = await login().expect(429);
    expect(res.body.error).toMatchObject({
      code: 'TOO_MANY_REQUESTS',
      details: { retryAfter: expect.any(Number) },
    });
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('가입은 로그인과 따로 센다', async () => {
    for (let i = 0; i < 3; i++) await signupUser(app, `rl-signup-${i}`);
    await server()
      .post('/api/v1/auth/signup')
      .send({ email: uniqueEmail('rl'), password: 'abcd1234', nickname: 'x' })
      .expect(429);
  });

  it('분석·초안 생성은 사용자당 한도를 함께 쓰고, 다른 사용자에게는 영향이 없다', async () => {
    const a = await signupUserViaDb('rl-ai-a');
    const b = await signupUserViaDb('rl-ai-b');
    const call = (who: string, path: string) =>
      server()
        .post(`/api/v1/entries/2020-01-01/${path}`)
        .set('Authorization', `Bearer ${who}`)
        .send({});

    await call(a, 'analyze').expect(404); // 없는 일기여도 호출은 센다
    await call(a, 'generate').expect(404);
    await call(a, 'analyze').expect(429);
    await call(a, 'generate').expect(429);
    await call(b, 'analyze').expect(404);
  });

  it('과거의 나 메시지는 사용자당 시간 한도', async () => {
    const a = await signupUserViaDb('rl-chat');
    const send = () =>
      server()
        .post(
          '/api/v1/chat/sessions/00000000-0000-4000-8000-000000000000/messages',
        )
        .set('Authorization', `Bearer ${a}`)
        .send({ content: '안녕' });
    await send().expect(404);
    await send().expect(404);
    await send().expect(429);
  });

  it('제한 대상이 아닌 엔드포인트는 막히지 않는다', async () => {
    const a = await signupUserViaDb('rl-free');
    for (let i = 0; i < 10; i++) {
      await server()
        .get('/api/v1/checklist/categories')
        .set('Authorization', `Bearer ${a}`)
        .expect(200);
    }
  });

  // 가입 한도(분당 3회)를 피하려고 테스트용 사용자는 별도 앱 없이 토큰만 만든다
  async function signupUserViaDb(prefix: string): Promise<string> {
    const { JwtService } = await import('@nestjs/jwt');
    const { PrismaService } = await import('./../src/prisma/prisma.service.js');
    const prisma = app.get(PrismaService);
    const user = await prisma.user.create({
      data: { email: uniqueEmail(prefix), passwordHash: 'x', nickname: prefix },
    });
    return app.get(JwtService).signAsync({ sub: user.id });
  }
});
