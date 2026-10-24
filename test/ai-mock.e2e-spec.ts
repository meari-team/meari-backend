import type { INestApplication } from '@nestjs/common';
import { rm } from 'node:fs/promises';
import sharp from 'sharp';
import request from 'supertest';
import { AiClient } from './../src/ai-client/ai-client.service.js';
import { MockAiClient } from './../src/ai-client/mock-ai-client.js';
import { createTestApp, signupUser } from './utils/create-app.js';

// 시연용 가짜 AI 모드: AI 서버 없이 분석 → 질문 → 답변까지 흐름이 동작해야 한다
describe('AI_MOCK=true (e2e)', () => {
  let app: INestApplication;
  let me: { token: string; userId: string };

  beforeAll(async () => {
    process.env.AI_MOCK = 'true';
    process.env.AI_MOCK_DELAY_MS = '0';
    app = await createTestApp();
    me = await signupUser(app, 'mock');
  });

  afterAll(async () => {
    delete process.env.AI_MOCK;
    delete process.env.AI_MOCK_DELAY_MS;
    await app.close();
    await rm('.test-uploads', { recursive: true, force: true });
  });

  it('MockAiClient가 주입된다', () => {
    expect(app.get(AiClient)).toBeInstanceOf(MockAiClient);
  });

  it('AI 서버 없이 사진 → 분석 → 질문 → 답변 → READY', async () => {
    const server = () => request(app.getHttpServer());
    const bearer = `Bearer ${me.token}`;
    const img = await sharp({
      create: { width: 32, height: 32, channels: 3, background: '#ccc' },
    })
      .jpeg()
      .toBuffer();

    await server()
      .post('/api/v1/entries/2026-04-01/photos')
      .set('Authorization', bearer)
      .attach('files', img, { filename: 'a.jpg', contentType: 'image/jpeg' })
      .expect(201);

    const analyzed = await server()
      .post('/api/v1/entries/2026-04-01/analyze')
      .set('Authorization', bearer)
      .expect(200);
    expect(analyzed.body.status).toBe('QUESTIONING');
    expect(analyzed.body.questions).toHaveLength(2);

    const done = await server()
      .put('/api/v1/entries/2026-04-01/answers')
      .set('Authorization', bearer)
      .send({
        answers: analyzed.body.questions.map((q: { id: string }) => ({
          questionId: q.id,
          answer: '친구랑',
        })),
      })
      .expect(200);
    expect(done.body.status).toBe('READY');
  });
});
