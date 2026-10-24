import { HttpException, HttpStatus } from '@nestjs/common';

// 클라이언트가 분기하는 에러 코드. 목록은 meari-docs api.md §0과 맞춘다.
export type ErrorCode =
  | 'VALIDATION_FAILED'
  | 'UNAUTHORIZED'
  | 'INVALID_CREDENTIALS'
  | 'EMAIL_TAKEN'
  | 'NOT_FOUND'
  | 'TOO_MANY_REQUESTS'
  | 'INTERNAL_ERROR';

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
