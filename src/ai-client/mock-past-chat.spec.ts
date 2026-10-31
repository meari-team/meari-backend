import { mockPastChat, toCasual, type MockDiary } from './mock-past-chat.js';

const diaries: MockDiary[] = [
  {
    id: 'c',
    date: '2026-10-24',
    content:
      '메이커톤 발표 준비로 하루 종일 학교에 있었다. 피곤했지만 뿌듯했다.',
    note: '발표 준비',
  },
  {
    id: 'b',
    date: '2026-10-22',
    content: '이산수학 시험을 봤다. 그래도 끝나서 홀가분하다.',
    note: null,
  },
  {
    id: 'a',
    date: '2026-10-11',
    content: '친구랑 카페에서 공부했다.',
    note: '카페',
  },
];

describe('mockPastChat (가짜 AI의 과거의 나)', () => {
  it('일기 문장을 반말로', () => {
    expect(toCasual('학교에 있었다.')).toBe('학교에 있었어.');
    expect(toCasual('뿌듯했다.')).toBe('뿌듯했어.');
    expect(toCasual('시험을 봤다. 끝나서 홀가분하다.')).toBe(
      '시험을 봤어. 끝나서 홀가분해.',
    );
    expect(toCasual('오늘은 시간이 없다.')).toBe('오늘은 시간이 없어.');
  });

  it('질문 낱말과 맞는 일기를 읽어 답하고 참고한 기록을 붙인다', () => {
    const r = mockPastChat('시험은 어땠어?', '2026-10-24', diaries);
    expect(r.answer).toContain('10월 22일에는 이산수학 시험을 봤어.');
    expect(r.references).toEqual([{ diary_id: 'b', diary_date: '2026-10-22' }]);
  });

  it('가장 잘 맞는 일기만, 비슷한 말도 찾는다', () => {
    const more: MockDiary[] = [
      ...diaries,
      {
        id: 'd',
        date: '2026-10-19',
        content: '중간고사 공부를 했다. 걱정이 많았다.',
        note: null,
      },
    ];
    expect(
      mockPastChat('그때 무슨 고민 있었어?', '2026-10-24', more).references.map(
        (x) => x.diary_id,
      ),
    ).toEqual(['d']);
    expect(
      mockPastChat('카페 공부는 어땠어?', '2026-10-24', more).references.map(
        (x) => x.diary_id,
      ),
    ).toEqual(['a']);
  });

  it('날짜를 말하면 그날 일기로, 없으면 모른다고', () => {
    expect(
      mockPastChat('10월 11일에 뭐 했어?', '2026-10-24', diaries).references[0]
        .diary_id,
    ).toBe('a');
    const none = mockPastChat('10월 12일에 뭐 했어?', '2026-10-24', diaries);
    expect(none.answer).toContain('남겨 둔 기록이 없어');
    expect(none.references).toEqual([]);
  });

  it('맞는 일기가 없으면 최근 기록으로, 기록이 하나도 없으면 없다고', () => {
    expect(
      mockPastChat('요즘 어때?', '2026-10-24', diaries).references.map(
        (x) => x.diary_id,
      ),
    ).toEqual(['c', 'b']);
    expect(mockPastChat('안녕', '2026-10-24', []).references).toEqual([]);
  });
});
