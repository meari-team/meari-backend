import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  toAiClientError,
  type AiCallKind,
  type AiFailure,
} from './ai-client.error.js';
import type {
  AiErrorBody,
  ClarificationRequest,
  ClarificationResult,
  DiaryGenerateRequest,
  DiaryGenerateResult,
  ImageAnalysis,
  ImageFile,
  IndexDiaryRequest,
  IndexResult,
  PastChatRequest,
  PastChatResult,
} from './ai-client.types.js';

type CallOptions = {
  op: string;
  kind: AiCallKind;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  body?: unknown;
  form?: FormData;
  isValid: (data: unknown) => boolean;
};

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isStringArray = (v: unknown) =>
  Array.isArray(v) && v.every((x) => typeof x === 'string');
const isNullableString = (v: unknown) => v === null || typeof v === 'string';

const isImageAnalysis = (v: unknown): v is ImageAnalysis =>
  isObject(v) &&
  isNullableString(v.location) &&
  isStringArray(v.people) &&
  isStringArray(v.actions) &&
  isStringArray(v.objects) &&
  isNullableString(v.atmosphere) &&
  isStringArray(v.uncertain_information);

const isClarification = (v: unknown) =>
  isObject(v) &&
  typeof v.needs_clarification === 'boolean' &&
  Array.isArray(v.questions) &&
  v.questions.every(
    (q) =>
      isObject(q) &&
      typeof q.id === 'string' &&
      typeof q.question === 'string' &&
      typeof q.reason === 'string',
  );

const isDiary = (v: unknown) =>
  isObject(v) && typeof v.content === 'string' && v.content.length > 0;

const isIndexResult = (v: unknown) =>
  isObject(v) && typeof v.indexed === 'boolean';

const isPastChat = (v: unknown) =>
  isObject(v) &&
  typeof v.answer === 'string' &&
  Array.isArray(v.references) &&
  v.references.every(
    (r) =>
      isObject(r) &&
      typeof r.diary_id === 'string' &&
      typeof r.diary_date === 'string',
  );

const errorCodeOf = (v: unknown): string | null =>
  isObject(v) && isObject(v.error) && typeof v.error.code === 'string'
    ? (v as AiErrorBody).error.code
    : null;

// AI 서버(meari-ai) 호출은 모두 여기를 거친다.
// - 서비스 토큰은 서버 환경변수에만 있고 앱으로 나가지 않는다.
// - 생성·채팅은 재시도하지 않는다 (AI 서버가 Gemini 재시도를 이미 한다).
// - 로그에는 경로·상태·소요 시간만 남기고 본문(일기·사진·질문)은 남기지 않는다.
@Injectable()
export class AiClient {
  private readonly logger = new Logger(AiClient.name);
  private readonly baseUrl: string | undefined;
  private readonly token: string | undefined;
  private readonly timeouts: Record<AiCallKind, number>;

  constructor(config: ConfigService) {
    this.baseUrl = config.get<string>('AI_SERVER_URL')?.replace(/\/+$/, '');
    this.token = config.get<string>('AI_SERVICE_TOKEN');
    this.timeouts = {
      generate: Number(config.get('AI_TIMEOUT_GENERATE_MS', 45_000)),
      chat: Number(config.get('AI_TIMEOUT_CHAT_MS', 30_000)),
      index: Number(config.get('AI_TIMEOUT_INDEX_MS', 15_000)),
    };
  }

  async analyzeImages(
    images: ImageFile[],
    description: string,
  ): Promise<ImageAnalysis> {
    const form = new FormData();
    for (const image of images) {
      form.append(
        'images',
        new Blob([new Uint8Array(image.buffer)], { type: image.mimetype }),
        image.filename,
      );
    }
    form.append('description', description);
    return this.call<ImageAnalysis>({
      op: 'analyze_images',
      kind: 'generate',
      method: 'POST',
      path: '/ai/images/analyze',
      form,
      isValid: isImageAnalysis,
    });
  }

  clarify(body: ClarificationRequest): Promise<ClarificationResult> {
    return this.call({
      op: 'clarify',
      kind: 'generate',
      method: 'POST',
      path: '/ai/clarifications',
      body,
      isValid: isClarification,
    });
  }

  generateDiary(body: DiaryGenerateRequest): Promise<DiaryGenerateResult> {
    return this.call({
      op: 'generate_diary',
      kind: 'generate',
      method: 'POST',
      path: '/ai/diaries/generate',
      body,
      isValid: isDiary,
    });
  }

  // 확정본만 색인한다. finalized는 AI 서버 계약상 항상 true.
  indexDiary(req: IndexDiaryRequest): Promise<IndexResult> {
    return this.call({
      op: 'index_diary',
      kind: 'index',
      method: 'PUT',
      path: `/ai/diaries/${encodeURIComponent(req.diary_id)}/index`,
      body: { ...req, finalized: true },
      isValid: isIndexResult,
    });
  }

  // 멱등. 없는 색인을 지워도 성공한다.
  deleteDiaryIndex(userId: string, diaryId: string): Promise<IndexResult> {
    const query = new URLSearchParams({ user_id: userId });
    return this.call({
      op: 'delete_diary_index',
      kind: 'index',
      method: 'DELETE',
      path: `/ai/diaries/${encodeURIComponent(diaryId)}/index?${query.toString()}`,
      isValid: isIndexResult,
    });
  }

  pastChat(body: PastChatRequest): Promise<PastChatResult> {
    return this.call({
      op: 'past_chat',
      kind: 'chat',
      method: 'POST',
      path: '/ai/past-chat',
      body,
      isValid: isPastChat,
    });
  }

  private async call<T>(opts: CallOptions): Promise<T> {
    const started = Date.now();
    const fail = (failure: AiFailure): never => {
      this.log(opts, started, failure);
      throw toAiClientError(opts.kind, failure);
    };

    if (!this.baseUrl || !this.token) return fail({ type: 'not_configured' });

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      Accept: 'application/json',
    };
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${opts.path}`, {
        method: opts.method,
        headers,
        body:
          opts.form ??
          (opts.body === undefined ? undefined : JSON.stringify(opts.body)),
        signal: AbortSignal.timeout(this.timeouts[opts.kind]),
      });
    } catch (e) {
      const name = e instanceof Error ? e.name : '';
      return fail({
        type:
          name === 'TimeoutError' || name === 'AbortError'
            ? 'timeout'
            : 'network',
      });
    }

    let data: unknown = null;
    try {
      data = await res.json();
    } catch {
      // 본문이 JSON이 아닌 경우 — 아래에서 상태 코드로 판단한다
    }

    if (!res.ok) {
      return fail({
        type: 'http',
        status: res.status,
        aiCode: errorCodeOf(data),
      });
    }
    if (!opts.isValid(data)) return fail({ type: 'invalid_response' });

    this.log(opts, started);
    return data as T;
  }

  private log(opts: CallOptions, started: number, failure?: AiFailure) {
    const entry = JSON.stringify({
      event: 'ai_call',
      op: opts.op,
      method: opts.method,
      ok: !failure,
      latencyMs: Date.now() - started,
      ...failure,
    });
    if (!failure) this.logger.log(entry);
    else if (failure.type === 'http' && failure.status >= 500)
      this.logger.warn(entry);
    else if (failure.type === 'timeout' || failure.type === 'network')
      this.logger.warn(entry);
    // 401·409·422·설정 누락·응답 형식 오류는 우리 쪽 버그나 설정 문제다
    else this.logger.error(entry);
  }
}
