import { AppException } from '../errors/app.exception.js';
import {
  isValidDateString,
  parseDateParam,
  todayKst,
} from './parse-date.pipe.js';

describe('todayKst', () => {
  it('UTC 15시 이후는 KST로 다음 날이다', () => {
    expect(todayKst(new Date('2026-10-24T14:59:59Z'))).toBe('2026-10-24');
    expect(todayKst(new Date('2026-10-24T15:00:00Z'))).toBe('2026-10-25');
  });
});

describe('isValidDateString', () => {
  it.each(['2026-10-24', '2024-02-29'])('%s는 유효', (v) => {
    expect(isValidDateString(v)).toBe(true);
  });
  it.each([
    '2026-13-01',
    '2026-02-30',
    '2025-02-29',
    '2026-1-1',
    '20261024',
    '',
  ])('%s는 무효', (v) => {
    expect(isValidDateString(v)).toBe(false);
  });
});

describe('parseDateParam', () => {
  // KST 2026-10-24 12:00
  const now = new Date('2026-10-24T03:00:00Z');
  const pipe = { transform: (v: string) => parseDateParam(v, now) };

  const codeOf = (fn: () => unknown) => {
    try {
      fn();
    } catch (e) {
      return (e as AppException).code;
    }
    return null;
  };

  it('오늘과 과거 날짜는 통과', () => {
    expect(pipe.transform('2026-10-24')).toBe('2026-10-24');
    expect(pipe.transform('2025-01-01')).toBe('2025-01-01');
  });

  it('내일은 DATE_IN_FUTURE', () => {
    expect(codeOf(() => pipe.transform('2026-10-25'))).toBe('DATE_IN_FUTURE');
  });

  it('형식이 틀리면 VALIDATION_FAILED', () => {
    expect(codeOf(() => pipe.transform('2026/10/24'))).toBe(
      'VALIDATION_FAILED',
    );
  });
});
