// 메아리 예약 회차 계산 (사용자 시간대 기준). 순수 함수라 DB 없이 테스트한다.
import type { EchoFrequency } from '@prisma/client';

export type EchoScheduleInput = {
  frequency: EchoFrequency;
  weekday: number; // 0=일 … 6=토
  monthDay: number; // 1~31
  minuteOfDay: number; // 0~1439
  timezone: string; // IANA, 예: Asia/Seoul
};

type LocalDate = { y: number; m: number; d: number };

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string) {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    formatters.set(tz, f);
  }
  return f;
}

// 그 순간 그 시간대의 벽시계 (연·월·일·시·분)
function wallClock(utcMs: number, tz: string) {
  const parts = Object.fromEntries(
    formatter(tz)
      .formatToParts(new Date(utcMs))
      .filter((p) => p.type !== 'literal')
      .map((p) => [p.type, Number(p.value)]),
  ) as Record<'year' | 'month' | 'day' | 'hour' | 'minute' | 'second', number>;
  return parts;
}

// UTC와 그 시간대의 차이 (ms). 서울 = +9시간
function offsetMs(utcMs: number, tz: string) {
  const w = wallClock(utcMs, tz);
  const asUtc = Date.UTC(
    w.year,
    w.month - 1,
    w.day,
    w.hour,
    w.minute,
    w.second,
  );
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

// 그 시간대의 날짜·분 → UTC 순간. 서머타임 경계도 두 번 맞춰 본다
export function zonedToUtc(date: LocalDate, minuteOfDay: number, tz: string) {
  const guess = Date.UTC(date.y, date.m - 1, date.d, 0, minuteOfDay);
  const first = guess - offsetMs(guess, tz);
  const second = guess - offsetMs(first, tz);
  return new Date(second);
}

export function localDateOf(utcMs: number, tz: string): LocalDate {
  const w = wallClock(utcMs, tz);
  return { y: w.year, m: w.month, d: w.day };
}

const addDays = (date: LocalDate, days: number): LocalDate => {
  const t = new Date(Date.UTC(date.y, date.m - 1, date.d + days));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
};
const weekdayOf = (date: LocalDate) =>
  new Date(Date.UTC(date.y, date.m - 1, date.d)).getUTCDay();
const daysInMonth = (y: number, m: number) =>
  new Date(Date.UTC(y, m, 0)).getUTCDate();

// after보다 뒤인 첫 회차. 다시 동의하거나 서버가 멈춰 회차를 놓쳤으면 지금 이후부터 (몰아서 보내지 않는다)
export function nextEchoRun(s: EchoScheduleInput, after: Date): Date {
  const start = localDateOf(after.getTime(), s.timezone);
  if (s.frequency === 'WEEKLY') {
    for (let i = 0; i <= 8; i++) {
      const date = addDays(start, i);
      if (weekdayOf(date) !== s.weekday) continue;
      const at = zonedToUtc(date, s.minuteOfDay, s.timezone);
      if (at > after) return at;
    }
  } else {
    for (let k = 0; k <= 2; k++) {
      const first = new Date(Date.UTC(start.y, start.m - 1 + k, 1));
      const y = first.getUTCFullYear();
      const m = first.getUTCMonth() + 1;
      // 그달에 없는 날짜(31일 등)는 마지막 날
      const d = Math.min(s.monthDay, daysInMonth(y, m));
      const at = zonedToUtc({ y, m, d }, s.minuteOfDay, s.timezone);
      if (at > after) return at;
    }
  }
  throw new Error('다음 메아리 회차를 계산하지 못했어요.');
}

export const formatMinute = (minuteOfDay: number) =>
  `${String(Math.floor(minuteOfDay / 60)).padStart(2, '0')}:${String(minuteOfDay % 60).padStart(2, '0')}`;

export function parseTime(time: string): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}
