import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { AiClientError } from './ai-client.error.js';
import { AiClient } from './ai-client.service.js';

type Captured = {
  method?: string;
  url?: string;
  headers: IncomingMessage['headers'];
  body: string;
};
type Reply = { status: number; body?: unknown; delayMs?: number; raw?: string };

// AI 서버 대역. 테스트마다 reply를 바꿔 응답을 정한다.
let server: Server;
let baseUrl: string;
let reply: Reply;
let captured: Captured;

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      captured = {
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      };
      setTimeout(() => {
        res.writeHead(reply.status, { 'content-type': 'application/json' });
        res.end(reply.raw ?? JSON.stringify(reply.body ?? {}));
      }, reply.delayMs ?? 0);
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
});

let errorLog: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  errorLog = vi
    .spyOn(Logger.prototype, 'error')
    .mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

const makeClient = (env: Record<string, unknown> = {}) => {
  const values: Record<string, unknown> = {
    AI_SERVER_URL: baseUrl,
    AI_SERVICE_TOKEN: 'service-token',
    AI_TIMEOUT_GENERATE_MS: 300,
    AI_TIMEOUT_CHAT_MS: 300,
    AI_TIMEOUT_INDEX_MS: 300,
    ...env,
  };
  const config = {
    get: (key: string, fallback?: unknown) => values[key] ?? fallback,
  } as unknown as ConfigService;
  return new AiClient(config);
};

async function failureOf(p: Promise<unknown>): Promise<AiClientError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(AiClientError);
    return e as AiClientError;
  }
  throw new Error('실패해야 하는데 성공했다');
}

const ANALYSIS = {
  location: '카페로 보이는 실내',
  people: [],
  actions: [],
  objects: ['컵'],
  atmosphere: null,
  uncertain_information: ['함께 있는 사람'],
};

describe('AiClient 요청 형식', () => {
  it('서비스 토큰을 Bearer로 보내고 JSON 본문을 그대로 전달한다', async () => {
    reply = {
      status: 200,
      body: { diary_date: '2026-10-01', content: '일기' },
    };
    const res = await makeClient().generateDiary({
      diary_date: '2026-10-01',
      description: '카페',
      clarification_answers: { q1: '친구' },
    });

    expect(res.content).toBe('일기');
    expect(captured.method).toBe('POST');
    expect(captured.url).toBe('/ai/diaries/generate');
    expect(captured.headers.authorization).toBe('Bearer service-token');
    expect(JSON.parse(captured.body)).toEqual({
      diary_date: '2026-10-01',
      description: '카페',
      clarification_answers: { q1: '친구' },
    });
  });

  it('사진 분석은 multipart의 images 필드(반복)와 description으로 보낸다', async () => {
    reply = { status: 200, body: ANALYSIS };
    const res = await makeClient().analyzeImages(
      [
        { buffer: Buffer.from('a'), filename: 'a.jpg', mimetype: 'image/jpeg' },
        { buffer: Buffer.from('b'), filename: 'b.png', mimetype: 'image/png' },
      ],
      '오늘 점심',
    );

    expect(res).toEqual(ANALYSIS);
    expect(captured.headers['content-type']).toMatch(/^multipart\/form-data/);
    expect(captured.body.match(/name="images"/g)).toHaveLength(2);
    expect(captured.body).toContain('filename="a.jpg"');
    expect(captured.body).toContain('name="description"');
  });

  it('색인 PUT은 finalized: true를 붙이고, 경로의 ID를 인코딩한다', async () => {
    reply = {
      status: 200,
      body: { user_id: 'u', diary_id: 'd/1', indexed: true },
    };
    await makeClient().indexDiary({
      user_id: 'u',
      diary_id: 'd/1',
      diary_date: '2026-10-01',
      content: '확정본',
    });

    expect(captured.method).toBe('PUT');
    expect(captured.url).toBe('/ai/diaries/d%2F1/index');
    expect(JSON.parse(captured.body)).toMatchObject({ finalized: true });
  });

  it('색인 DELETE는 user_id를 쿼리로 보낸다', async () => {
    reply = {
      status: 200,
      body: { user_id: 'u 1', diary_id: 'd', indexed: false },
    };
    await makeClient().deleteDiaryIndex('u 1', 'd');

    expect(captured.method).toBe('DELETE');
    expect(captured.url).toBe('/ai/diaries/d/index?user_id=u+1');
  });

  it('AI_SERVER_URL 끝의 슬래시를 정리한다', async () => {
    reply = {
      status: 200,
      body: { user_id: 'u', target_date: 't', answer: 'a', references: [] },
    };
    await makeClient({ AI_SERVER_URL: `${baseUrl}/` }).pastChat({
      user_id: 'u',
      target_date: '2026-10-01',
      message: '안녕',
    });
    expect(captured.url).toBe('/ai/past-chat');
  });
});

describe('AiClient 에러 매핑 (api.md §4)', () => {
  it.each([401, 409, 422])(
    'AI 서버 %i은 502 AI_UPSTREAM_ERROR, 재시도 안 함, 에러 로그',
    async (status) => {
      reply = { status, body: { error: { code: 'x', message: 'm' } } };
      const err = await failureOf(
        makeClient().generateDiary({ diary_date: '2026-10-01' }),
      );

      expect(err.code).toBe('AI_UPSTREAM_ERROR');
      expect(err.getStatus()).toBe(502);
      expect(err.retryable).toBe(false);
      expect(errorLog).toHaveBeenCalled();
    },
  );

  it('AI 서버 502 ai_provider_error는 502 AI_UPSTREAM_ERROR', async () => {
    reply = {
      status: 502,
      body: { error: { code: 'ai_provider_error', message: 'm' } },
    };
    const err = await failureOf(
      makeClient().clarify({ image_analysis: ANALYSIS }),
    );
    expect(err.code).toBe('AI_UPSTREAM_ERROR');
    expect(err.failure).toEqual({
      type: 'http',
      status: 502,
      aiCode: 'ai_provider_error',
    });
  });

  it('색인 중 AI 서버 503은 503 AI_INDEX_UNAVAILABLE, 재시도 가능', async () => {
    reply = {
      status: 503,
      body: { error: { code: 'index_unavailable', message: 'm' } },
    };
    const err = await failureOf(
      makeClient().indexDiary({
        user_id: 'u',
        diary_id: 'd',
        diary_date: '2026-10-01',
        content: 'c',
      }),
    );
    expect(err.code).toBe('AI_INDEX_UNAVAILABLE');
    expect(err.getStatus()).toBe(503);
    expect(err.retryable).toBe(true);
  });

  it('생성 타임아웃은 504 AI_TIMEOUT', async () => {
    reply = {
      status: 200,
      body: { diary_date: 'x', content: 'y' },
      delayMs: 1000,
    };
    const err = await failureOf(
      makeClient().generateDiary({ diary_date: '2026-10-01' }),
    );
    expect(err.code).toBe('AI_TIMEOUT');
    expect(err.getStatus()).toBe(504);
  });

  it('색인 타임아웃은 재시도 가능한 503 (PUT은 멱등)', async () => {
    reply = { status: 200, body: { indexed: true }, delayMs: 1000 };
    const err = await failureOf(makeClient().deleteDiaryIndex('u', 'd'));
    expect(err.code).toBe('AI_INDEX_UNAVAILABLE');
    expect(err.retryable).toBe(true);
  });

  it('연결 실패: 채팅은 502, 색인은 재시도 가능한 503', async () => {
    const down = makeClient({ AI_SERVER_URL: 'http://127.0.0.1:1' });
    const chat = await failureOf(
      down.pastChat({ user_id: 'u', target_date: '2026-10-01', message: 'm' }),
    );
    const index = await failureOf(down.deleteDiaryIndex('u', 'd'));

    expect(chat.code).toBe('AI_UPSTREAM_ERROR');
    expect(index.code).toBe('AI_INDEX_UNAVAILABLE');
    expect(index.retryable).toBe(true);
  });

  it('응답 형식이 계약과 다르면 502 (예: content 누락)', async () => {
    reply = { status: 200, body: { diary_date: '2026-10-01' } };
    const err = await failureOf(
      makeClient().generateDiary({ diary_date: '2026-10-01' }),
    );
    expect(err.failure).toEqual({ type: 'invalid_response' });
    expect(err.code).toBe('AI_UPSTREAM_ERROR');
  });

  it('JSON이 아닌 5xx 본문도 처리한다', async () => {
    reply = { status: 500, raw: 'Internal Server Error' };
    const err = await failureOf(
      makeClient().clarify({ image_analysis: ANALYSIS }),
    );
    expect(err.failure).toEqual({ type: 'http', status: 500, aiCode: null });
  });

  it('설정이 없으면 호출하지 않고 502', async () => {
    const err = await failureOf(
      makeClient({ AI_SERVICE_TOKEN: '' }).generateDiary({
        diary_date: '2026-10-01',
      }),
    );
    expect(err.failure).toEqual({ type: 'not_configured' });
  });

  it('로그에 요청 본문(일기 내용)을 남기지 않는다', async () => {
    reply = {
      status: 422,
      body: { error: { code: 'validation_error', message: 'm' } },
    };
    await failureOf(
      makeClient().generateDiary({
        diary_date: '2026-10-01',
        description: '비밀스러운 일기',
      }),
    );
    const logged = JSON.stringify(errorLog.mock.calls);
    expect(logged).not.toContain('비밀스러운 일기');
    expect(logged).toContain('generate_diary');
  });
});
