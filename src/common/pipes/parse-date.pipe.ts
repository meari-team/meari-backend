import { HttpStatus, Injectable, PipeTransform } from '@nestjs/common';
import { AppException } from '../errors/app.exception.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// 오늘 날짜(KST)를 YYYY-MM-DD로. 서버 TZ와 무관하게 동작한다.
export function todayKst(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function isValidDateString(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

// 경로의 :date(YYYY-MM-DD, KST 기록일)를 검증한다. 오늘 이후 날짜는 422.
export function parseDateParam(value: unknown, now = new Date()): string {
  if (typeof value !== 'string' || !isValidDateString(value)) {
    throw new AppException(
      'VALIDATION_FAILED',
      HttpStatus.BAD_REQUEST,
      '날짜는 YYYY-MM-DD 형식이어야 해요.',
      [{ field: 'date', reasons: ['isDate'] }],
    );
  }
  if (value > todayKst(now)) {
    throw new AppException(
      'DATE_IN_FUTURE',
      HttpStatus.UNPROCESSABLE_ENTITY,
      '오늘 이후 날짜는 쓸 수 없어요.',
    );
  }
  return value;
}

@Injectable()
export class ParseDatePipe implements PipeTransform<unknown, string> {
  transform(value: unknown): string {
    return parseDateParam(value);
  }
}
