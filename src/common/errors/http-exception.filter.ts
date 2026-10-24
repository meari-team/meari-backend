import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { AppException, type ErrorCode } from './app.exception.js';

const CODE_BY_STATUS: Partial<Record<number, ErrorCode>> = {
  [HttpStatus.BAD_REQUEST]: 'VALIDATION_FAILED',
  [HttpStatus.UNAUTHORIZED]: 'UNAUTHORIZED',
  [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
  [HttpStatus.TOO_MANY_REQUESTS]: 'TOO_MANY_REQUESTS',
};

const MESSAGE_BY_CODE: Partial<Record<ErrorCode, string>> = {
  VALIDATION_FAILED: '요청 형식을 확인해 주세요.',
  UNAUTHORIZED: '로그인이 필요해요.',
  NOT_FOUND: '찾을 수 없어요.',
  TOO_MANY_REQUESTS: '잠시 후 다시 시도해 주세요.',
  INTERNAL_ERROR: '일시적인 오류가 발생했어요.',
};

// 모든 에러를 { error: { code, message, details } } 한 가지 형태로 내보낸다.
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();

    if (exception instanceof AppException) {
      res.status(exception.getStatus()).json({
        error: {
          code: exception.code,
          message: exception.message,
          details: exception.details,
        },
      });
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const code = CODE_BY_STATUS[status] ?? 'INTERNAL_ERROR';
      res.status(status).json({
        error: { code, message: MESSAGE_BY_CODE[code], details: null },
      });
      return;
    }

    // 원본 예외 메시지에는 입력값이 섞일 수 있어 클래스명과 스택만 남긴다.
    const err = exception instanceof Error ? exception : undefined;
    this.logger.error(err?.name ?? 'UnknownError', err?.stack);
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: MESSAGE_BY_CODE.INTERNAL_ERROR,
        details: null,
      },
    });
  }
}
