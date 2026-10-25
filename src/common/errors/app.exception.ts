import { HttpException, HttpStatus } from '@nestjs/common';

// 클라이언트가 분기하는 에러 코드. 목록은 meari-docs api.md §0과 맞춘다.
export const ERROR_CODES = [
  'VALIDATION_FAILED',
  'UNAUTHORIZED',
  'INVALID_CREDENTIALS',
  'NOT_FOUND',
  'ENTRY_NOT_FOUND',
  'PHOTO_NOT_FOUND',
  'SESSION_NOT_FOUND',
  'CATEGORY_NOT_FOUND',
  'SCHEDULE_NOT_FOUND',
  'EMAIL_TAKEN',
  'WRONG_PASSWORD',
  'SAME_PASSWORD',
  'INVALID_ENTRY_STATE',
  'FILE_TOO_LARGE',
  'UNSUPPORTED_MEDIA_TYPE',
  'DATE_IN_FUTURE',
  'PHOTO_LIMIT_EXCEEDED',
  'PHOTO_REQUIRED',
  'NOT_ENOUGH_RECORDS',
  'SESSION_MESSAGE_LIMIT',
  'SCHEDULE_LIMIT_EXCEEDED',
  'TOO_MANY_REQUESTS',
  'AI_UPSTREAM_ERROR',
  'AI_INDEX_UNAVAILABLE',
  'AI_TIMEOUT',
  'INTERNAL_ERROR',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export class AppException extends HttpException {
  constructor(
    readonly code: ErrorCode,
    status: HttpStatus,
    message: string,
    readonly details: unknown = null,
  ) {
    super(message, status);
  }
}
