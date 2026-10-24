import { DEFAULT_CHECKLIST } from './default-checklist.js';

// DB 컬럼 제약(name·label varchar(20), color char(7))을 기본값이 지키는지 확인한다.
describe('DEFAULT_CHECKLIST', () => {
  it('카테고리 6개, 이름은 1~20자', () => {
    expect(DEFAULT_CHECKLIST).toHaveLength(6);
    for (const c of DEFAULT_CHECKLIST) {
      expect(c.name.length).toBeGreaterThan(0);
      expect(c.name.length).toBeLessThanOrEqual(20);
    }
  });

  it('색은 #RRGGBB 형식', () => {
    for (const c of DEFAULT_CHECKLIST) {
      expect(c.color).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });

  it('항목은 카테고리당 1~10개, 라벨 1~20자', () => {
    for (const c of DEFAULT_CHECKLIST) {
      expect(c.items.length).toBeGreaterThan(0);
      expect(c.items.length).toBeLessThanOrEqual(10);
      for (const label of c.items) {
        expect(label.length).toBeGreaterThan(0);
        expect(label.length).toBeLessThanOrEqual(20);
      }
    }
  });
});
