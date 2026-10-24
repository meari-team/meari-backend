import { compareSchedules } from './schedules.service.js';

describe('compareSchedules', () => {
  const s = (date: string, time: string | null, createdAt: string) => ({
    date,
    time,
    createdAt,
  });

  it('날짜 → 시간(종일 먼저) → 등록순', () => {
    const items = [
      s('2026-10-02', '09:00', 't1'),
      s('2026-10-01', '14:00', 't2'),
      s('2026-10-01', null, 't5'),
      s('2026-10-01', '09:30', 't4'),
      s('2026-10-01', '09:30', 't3'),
    ].sort(compareSchedules);
    expect(
      items.map((i) => `${i.date} ${i.time ?? '종일'} ${i.createdAt}`),
    ).toEqual([
      '2026-10-01 종일 t5',
      '2026-10-01 09:30 t3',
      '2026-10-01 09:30 t4',
      '2026-10-01 14:00 t2',
      '2026-10-02 09:00 t1',
    ]);
  });
});
