import { checklistOf, describeEntry } from './generation.service.js';

describe('AI 입력 만들기', () => {
  it('설명 = 한 줄 설명 + 캡션 있는 사진만 번호와 함께', () => {
    expect(
      describeEntry({
        note: '수업 끝나고',
        photos: [{ caption: '카페' }, { caption: null }, { caption: '노을' }],
      }),
    ).toBe('수업 끝나고\n사진 1: 카페\n사진 3: 노을');
  });

  it('그날 일정을 시간과 함께 한 줄씩 덧붙인다 (종일은 시간 없이)', () => {
    expect(
      describeEntry({ note: '수업 끝나고', photos: [] }, [
        { title: '동아리 모임', time: null },
        { title: '팀플 회의', time: '14:00' },
      ]),
    ).toBe('수업 끝나고\n일정: 동아리 모임\n일정: 14:00 팀플 회의');
  });

  it('설명 없이 일정만 있어도 들어간다', () => {
    expect(
      describeEntry({ note: null, photos: [{ caption: null }] }, [
        { title: '병원', time: '09:30' },
      ]),
    ).toBe('일정: 09:30 병원');
  });

  it('설명할 게 없으면 빈 문자열', () => {
    expect(describeEntry({ note: null, photos: [{ caption: null }] })).toBe('');
  });

  it('체크리스트는 "카테고리/항목": true', () => {
    expect(
      checklistOf({
        checks: [
          { item: { label: '걷기', category: { name: '운동' } } },
          { item: { label: '공부', category: { name: '학습/업무' } } },
        ],
      }),
    ).toEqual({ '운동/걷기': true, '학습/업무/공부': true });
  });
});
