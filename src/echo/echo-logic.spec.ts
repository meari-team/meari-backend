import {
  ECHO_QUESTION,
  composeEchoMessage,
  echoPushContent,
  echoSender,
  fallbackMessage,
} from './echo-message.js';
import { pickEchoEntry } from './echo-pick.js';
import { nextEchoRun, parseTime, zonedToUtc } from './echo-schedule.js';

const iso = (d: Date) => d.toISOString();
const seoul = {
  timezone: 'Asia/Seoul',
  minuteOfDay: 21 * 60,
  weekday: 0,
  monthDay: 1,
};

describe('nextEchoRun', () => {
  it('주 1회: 그 주 요일·시각 (서울 일요일 21:00 = UTC 12:00)', () => {
    // 2026-11-01은 일요일. 그날 20:00(KST)이면 당일 21:00
    const after = new Date('2026-11-01T11:00:00Z');
    expect(iso(nextEchoRun({ ...seoul, frequency: 'WEEKLY' }, after))).toBe(
      '2026-11-01T12:00:00.000Z',
    );
  });

  it('주 1회: 시각이 지났으면 다음 주', () => {
    const after = new Date('2026-11-01T12:00:00Z');
    expect(iso(nextEchoRun({ ...seoul, frequency: 'WEEKLY' }, after))).toBe(
      '2026-11-08T12:00:00.000Z',
    );
  });

  it('주 1회: 사용자 시간대 기준 (뉴욕 월요일 09:30)', () => {
    const s = {
      frequency: 'WEEKLY' as const,
      weekday: 1,
      monthDay: 1,
      minuteOfDay: 9 * 60 + 30,
      timezone: 'America/New_York',
    };
    // 2026-11-01 일요일 서울 낮 = 뉴욕 10월 31일 밤
    expect(iso(nextEchoRun(s, new Date('2026-11-01T03:00:00Z')))).toBe(
      // 11월 1일 서머타임 종료 → 11월 2일은 EST(UTC-5)
      '2026-11-02T14:30:00.000Z',
    );
  });

  it('월 1회: 그달에 없는 날짜는 마지막 날 (31일 → 2월 28일, 윤년 29일)', () => {
    const s = { ...seoul, frequency: 'MONTHLY' as const, monthDay: 31 };
    expect(iso(nextEchoRun(s, new Date('2027-02-01T00:00:00Z')))).toBe(
      '2027-02-28T12:00:00.000Z',
    );
    expect(iso(nextEchoRun(s, new Date('2028-02-01T00:00:00Z')))).toBe(
      '2028-02-29T12:00:00.000Z',
    );
    expect(iso(nextEchoRun(s, new Date('2026-11-01T00:00:00Z')))).toBe(
      '2026-11-30T12:00:00.000Z',
    );
  });

  it('월 1회: 이번 달 날짜가 지났으면 다음 달', () => {
    const s = { ...seoul, frequency: 'MONTHLY' as const, monthDay: 1 };
    expect(iso(nextEchoRun(s, new Date('2026-11-01T12:00:00Z')))).toBe(
      '2026-12-01T12:00:00.000Z',
    );
  });

  it('놓친 회차는 몰아서 보내지 않는다: 몇 주가 지나도 지금 이후 첫 회차 하나', () => {
    const s = { ...seoul, frequency: 'WEEKLY' as const };
    // 마지막 회차(10월 4일) 뒤로 한 달 쉬었다가 11월 1일 22시(KST)에 다시 켬
    expect(iso(nextEchoRun(s, new Date('2026-11-01T13:00:00Z')))).toBe(
      '2026-11-08T12:00:00.000Z',
    );
  });

  it('zonedToUtc: 서울 자정 넘김', () => {
    expect(iso(zonedToUtc({ y: 2026, m: 1, d: 1 }, 30, 'Asia/Seoul'))).toBe(
      '2025-12-31T15:30:00.000Z',
    );
  });

  it('parseTime', () => {
    expect(parseTime('21:00')).toBe(1260);
    expect(parseTime('00:05')).toBe(5);
    expect(parseTime('24:00')).toBeNull();
    expect(parseTime('9:00')).toBeNull();
  });
});

describe('pickEchoEntry', () => {
  it('후보가 없으면 null', () => {
    expect(pickEchoEntry([], ['a'])).toBeNull();
  });

  it('후보가 하나면 매번 그 일기 (연속 허용)', () => {
    expect(pickEchoEntry(['a'], ['a', 'a'])).toBe('a');
  });

  it('아직 안 보낸 일기부터', () => {
    expect(pickEchoEntry(['a', 'b', 'c'], ['a', 'b'], () => 0)).toBe('c');
    expect(pickEchoEntry(['a', 'b', 'c'], ['a', 'b'], () => 0.99)).toBe('c');
  });

  it('다 보냈으면 다시 섞되 바로 전에 보낸 일기는 연속으로 고르지 않는다', () => {
    for (const r of [0, 0.3, 0.6, 0.99]) {
      expect(pickEchoEntry(['a', 'b'], ['b', 'a'], () => r)).toBe('a');
      expect(pickEchoEntry(['a', 'b', 'c'], ['c', 'b', 'a'], () => r)).not.toBe(
        'c',
      );
    }
  });

  it('여러 후보면 무작위 (덜 보낸 것들 중에서)', () => {
    const seen = new Set(
      [0, 0.34, 0.67].map((r) => pickEchoEntry(['a', 'b', 'c'], [], () => r)),
    );
    expect(seen).toEqual(new Set(['a', 'b', 'c']));
  });

  it('북마크 해제된 일기 기록은 무시한다', () => {
    expect(pickEchoEntry(['a', 'b'], ['x', 'a'], () => 0)).toBe('b');
  });
});

describe('composeEchoMessage', () => {
  const base = { date: '2026-10-18', hasPhotos: true, entryId: 'e1' };

  it('그 일기를 근거로 한 AI 답은 앞 두 문장 + 질문 하나', () => {
    const r = composeEchoMessage({
      ...base,
      ai: {
        answer:
          '내 기록을 보면, 10월 18일에는 메이커톤 팀원들과 첫 회의를 했어. 앱 이름을 메아리로 정했어. 그리고 밤늦게 집에 왔어. 너는 요즘 어때?',
        citedEntryIds: ['e1'],
      },
    });
    expect(r).toEqual({
      source: 'AI',
      message: `10월 18일의 나야. 이날은 메이커톤 팀원들과 첫 회의를 했어. 앱 이름을 메아리로 정했어. ${ECHO_QUESTION}`,
    });
  });

  it('AI가 실패하면 기본 문구 (사진 있음/없음)', () => {
    expect(composeEchoMessage({ ...base, ai: null })).toEqual({
      source: 'FALLBACK',
      message:
        '10월 18일의 나야. 이날 이 사진을 남겼어. 이 순간을 함께 돌아볼래?',
    });
    expect(fallbackMessage('2026-10-18', false)).toContain('이 하루를');
  });

  it('고른 일기를 근거로 삼지 않은 답은 버린다 (근거 부족)', () => {
    const r = composeEchoMessage({
      ...base,
      ai: { answer: '10월 20일에는 비가 왔어.', citedEntryIds: ['other'] },
    });
    expect(r.source).toBe('FALLBACK');
  });

  it('너무 길거나 내용이 없으면 기본 문구', () => {
    expect(
      composeEchoMessage({
        ...base,
        ai: { answer: '가'.repeat(300) + '.', citedEntryIds: ['e1'] },
      }).source,
    ).toBe('FALLBACK');
    expect(
      composeEchoMessage({
        ...base,
        ai: { answer: '요즘 어때?', citedEntryIds: ['e1'] },
      }).source,
    ).toBe('FALLBACK');
  });
});

describe('echoPushContent', () => {
  const msg =
    '10월 18일의 나야. 이날은 메이커톤 팀원들과 첫 회의를 했어. 앱 이름을 메아리로 정했어. 그날을 다시 떠올려 보면 어때?';

  it('기본은 일기 내용이 드러나지 않는 일반 문구', () => {
    const c = echoPushContent({
      date: '2026-10-18',
      message: msg,
      showPreview: false,
      platform: 'ios',
    });
    expect(c).toEqual({
      title: '기억하고 싶었던 하루가 찾아왔어요',
      subtitle: '2026.10.18의 나',
      body: '메시지가 도착했어요. 눌러서 확인해 보세요.',
    });
    expect(c.body).not.toContain('메이커톤');
  });

  it('미리보기를 켜면 메시지 앞부분 (안드로이드는 발신자를 본문 앞에)', () => {
    const c = echoPushContent({
      date: '2026-10-18',
      message: msg,
      showPreview: true,
      platform: 'android',
    });
    expect(c.body.startsWith('2026.10.18의 나 · 10월 18일의 나야.')).toBe(true);
    expect(c.body.endsWith('…')).toBe(true);
  });

  it('발신자 표기', () => {
    expect(echoSender('2026-01-05')).toBe('2026.01.05의 나');
  });
});
