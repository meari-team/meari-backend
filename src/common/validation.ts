import { HttpStatus, ValidationError, ValidationPipe } from '@nestjs/common';
import { AppException } from './errors/app.exception.js';

type FieldError = { field: string; reasons: string[] };

function flatten(errors: ValidationError[], parent = ''): FieldError[] {
  return errors.flatMap((e) => {
    const field = parent ? `${parent}.${e.property}` : e.property;
    const own = e.constraints
      ? [{ field, reasons: Object.keys(e.constraints) }]
      : [];
    return [...own, ...flatten(e.children ?? [], field)];
  });
}

// 정의되지 않은 필드(예: body의 userId)는 거부한다 — mass assignment 방어.
export function createValidationPipe() {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    exceptionFactory: (errors) =>
      new AppException(
        'VALIDATION_FAILED',
        HttpStatus.BAD_REQUEST,
        '요청 형식을 확인해 주세요.',
        flatten(errors),
      ),
  });
}
