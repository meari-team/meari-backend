import { makeExcerpt } from './entry.mapper.js';

describe('makeExcerpt', () => {
  it('확정본 → AI 초안 → 한 줄 설명 순으로 처음 비어 있지 않은 것', () => {
    expect(makeExcerpt('확정본', '초안', '설명')).toBe('확정본');
    expect(makeExcerpt(null, '초안', '설명')).toBe('초안');
    expect(makeExcerpt('  \n ', '', '설명')).toBe('설명');
    expect(makeExcerpt(null, undefined, null)).toBeNull();
  });

  it('공백·줄바꿈을 한 칸으로 정리한다', () => {
    expect(makeExcerpt('  첫 줄\n\n둘째   줄\t끝 ')).toBe('첫 줄 둘째 줄 끝');
  });

  it('120자를 넘으면 120자 + …', () => {
    expect(makeExcerpt('가'.repeat(120))).toBe('가'.repeat(120));
    expect(makeExcerpt('가'.repeat(121))).toBe(`${'가'.repeat(120)}…`);
  });
});
