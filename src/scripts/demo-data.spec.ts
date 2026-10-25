import { DEFAULT_CHECKLIST } from '../checklist/default-checklist.js';
import {
  DEMO_ENTRIES,
  DEMO_SCHEDULES,
  entriesBefore,
  firstSentence,
} from './demo-data.js';

describe('시연 계정 데이터', () => {
  it('일기 90편, 날짜는 겹치지 않고 오름차순', () => {
    const dates = DEMO_ENTRIES.map(([date]) => date);
    expect(dates).toHaveLength(90);
    expect(new Set(dates).size).toBe(90);
    expect([...dates].sort()).toEqual(dates);
  });

  it('체크 항목은 모두 기본 체크리스트에 있는 이름', () => {
    const labels = new Set<string>(
      DEFAULT_CHECKLIST.flatMap((c) => [...c.items]),
    );
    for (const [date, , , checks] of DEMO_ENTRIES) {
      for (const label of checks) {
        expect(labels.has(label), `${date}: ${label}`).toBe(true);
      }
    }
  });

  it('본문·한 줄 설명은 DB 길이 제한 안', () => {
    for (const [, note, content] of DEMO_ENTRIES) {
      expect(note.length).toBeLessThanOrEqual(200);
      expect(content.length).toBeGreaterThan(0);
    }
    for (const [, title, time] of DEMO_SCHEDULES) {
      expect(title.length).toBeLessThanOrEqual(50);
      if (time) expect(time).toMatch(/^\d{2}:\d{2}$/);
    }
  });

  it('오늘 이후 날짜는 넣지 않는다', () => {
    const before = entriesBefore('2026-10-20');
    expect(before.every(([date]) => date < '2026-10-20')).toBe(true);
    expect(entriesBefore('2027-01-01')).toHaveLength(90);
  });

  it('첫 문장', () => {
    expect(firstSentence('오늘은 비. 내일은 맑음.')).toBe('오늘은 비.');
    expect(firstSentence('끝맺음 없음')).toBe('끝맺음 없음');
  });
});
