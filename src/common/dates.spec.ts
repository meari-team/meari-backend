import { daysBetween, fromDbDate, toDbDate } from './dates.js';

describe('dates', () => {
  it('YYYY-MM-DD ↔ DB Date 왕복이 서버 TZ와 무관하다', () => {
    expect(fromDbDate(toDbDate('2026-10-24'))).toBe('2026-10-24');
    expect(fromDbDate(toDbDate('2024-02-29'))).toBe('2024-02-29');
  });

  it('두 날짜 사이 일수', () => {
    expect(daysBetween('2026-10-01', '2026-10-31')).toBe(30);
    expect(daysBetween('2026-01-01', '2026-12-31')).toBe(364);
    expect(daysBetween('2026-10-02', '2026-10-01')).toBe(-1);
  });
});
