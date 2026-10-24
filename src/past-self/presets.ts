import type { Preset } from './past-self.dto.js';

// 프리셋을 기준 날짜(YYYY-MM-DD)로 바꾼다. 월 단위는 말일을 넘지 않게 맞춘다 (3/31 - 1M = 2/28).
export function presetAnchorDate(preset: Preset, today: string): string {
  const [y, m, d] = today.split('-').map(Number);
  const base = new Date(Date.UTC(y, m - 1, d));

  if (preset === '1W') {
    base.setUTCDate(base.getUTCDate() - 7);
    return base.toISOString().slice(0, 10);
  }

  const months = { '1M': 1, '3M': 3, '6M': 6, '1Y': 12 }[preset];
  const target = new Date(Date.UTC(y, m - 1 - months, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}
