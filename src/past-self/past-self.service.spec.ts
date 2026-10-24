import { filterCitations } from './past-self.service.js';

describe('filterCitations (근거 재검증)', () => {
  const valid = [
    { id: 'e1', date: '2026-09-01' },
    { id: 'e2', date: '2026-09-05' },
  ];

  it('검증된 일기만 남기고 날짜순으로 정렬한다', () => {
    expect(
      filterCitations(
        [
          { diary_id: 'e2', diary_date: '2026-09-05' },
          { diary_id: 'other-users', diary_date: '2026-09-02' },
          { diary_id: 'e1', diary_date: '2026-09-01' },
        ],
        valid,
      ),
    ).toEqual([
      { entryId: 'e1', date: '2026-09-01' },
      { entryId: 'e2', date: '2026-09-05' },
    ]);
  });

  it('날짜는 AI가 준 값이 아니라 메인 DB 값을 쓴다', () => {
    expect(
      filterCitations([{ diary_id: 'e1', diary_date: '2099-01-01' }], valid),
    ).toEqual([{ entryId: 'e1', date: '2026-09-01' }]);
  });

  it('중복을 없애고, 남는 게 없으면 빈 배열', () => {
    expect(
      filterCitations(
        [
          { diary_id: 'e1', diary_date: '2026-09-01' },
          { diary_id: 'e1', diary_date: '2026-09-01' },
        ],
        valid,
      ),
    ).toHaveLength(1);
    expect(
      filterCitations([{ diary_id: 'x', diary_date: '2026-09-01' }], valid),
    ).toEqual([]);
  });
});
