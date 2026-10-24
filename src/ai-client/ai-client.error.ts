import { HttpStatus } from '@nestjs/common';
import {
  AppException,
  type ErrorCode,
} from '../common/errors/app.exception.js';

export type AiCallKind = 'generate' | 'chat' | 'index';

export type AiFailure =
  | { type: 'timeout' }
  | { type: 'network' }
  | { type: 'invalid_response' }
  | { type: 'not_configured' }
  | { type: 'http'; status: number; aiCode: string | null };

// AI 서버 호출 실패. 사용자 응답은 AppException 규칙을 따르고,
// 색인 동기화(MEA-12)는 retryable로 재시도 여부를 판단한다.
export class AiClientError extends AppException {
  constructor(
    code: ErrorCode,
    status: HttpStatus,
    message: string,
    readonly failure: AiFailure,
    readonly retryable: boolean,
  ) {
    super(code, status, message);
  }
}

const UPSTREAM =
  '일기를 만드는 중 문제가 생겼어요. 잠시 후 다시 시도해 주세요.';
const INDEX_DOWN =
  '기억 저장소에 연결할 수 없어요. 잠시 후 다시 시도해 주세요.';
const TIMEOUT = 'AI 응답이 너무 오래 걸려요. 잠시 후 다시 시도해 주세요.';

// api.md §4 "AI 서버 에러 → NestJS 에러" 표를 코드로 옮긴 것
export function toAiClientError(
  kind: AiCallKind,
  failure: AiFailure,
): AiClientError {
  const indexDown = () =>
    new AiClientError(
      'AI_INDEX_UNAVAILABLE',
      HttpStatus.SERVICE_UNAVAILABLE,
      INDEX_DOWN,
      failure,
      true,
    );
  const upstream = (retryable: boolean) =>
    new AiClientError(
      'AI_UPSTREAM_ERROR',
      HttpStatus.BAD_GATEWAY,
      UPSTREAM,
      failure,
      retryable,
    );

  switch (failure.type) {
    case 'timeout':
      // 색인 PUT/DELETE는 멱등이라 결과를 몰라도 같은 요청을 다시 보내면 된다
      return kind === 'index'
        ? indexDown()
        : new AiClientError(
            'AI_TIMEOUT',
            HttpStatus.GATEWAY_TIMEOUT,
            TIMEOUT,
            failure,
            false,
          );
    case 'network':
      return kind === 'index' ? indexDown() : upstream(false);
    case 'not_configured':
    case 'invalid_response':
      return upstream(false);
    case 'http':
      if (failure.status === 503 || failure.aiCode === 'index_unavailable') {
        return kind === 'index' ? indexDown() : upstream(false);
      }
      // 502(AI 공급자 오류)·500은 사용자가 다시 시도할 수 있다.
      // 401·409·422 등은 설정·버그라 같은 요청을 반복하지 않는다.
      return upstream(false);
  }
}
