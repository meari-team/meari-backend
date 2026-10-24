import type { EntryStatus } from '@prisma/client';
import { AppException } from '../common/errors/app.exception.js';
import { assertCanDo, canDo, type EntryAction } from './entry-state.js';

const ALL: EntryStatus[] = [
  'DRAFT',
  'QUESTIONING',
  'READY',
  'GENERATED',
  'CONFIRMED',
];

// 표 전체를 고정한다. 바꾸려면 prd.md §7-1과 이 표를 같이 바꾼다.
const EXPECTED: Record<EntryAction, EntryStatus[]> = {
  analyze: ['DRAFT', 'QUESTIONING', 'READY', 'GENERATED'],
  answer: ['QUESTIONING'],
  generate: ['READY', 'GENERATED'],
  skipAndGenerate: ['QUESTIONING', 'READY', 'GENERATED'],
  confirm: ['READY', 'GENERATED', 'CONFIRMED'],
};

describe('entry state machine', () => {
  for (const [action, allowed] of Object.entries(EXPECTED) as [
    EntryAction,
    EntryStatus[],
  ][]) {
    it.each(ALL)(`${action} @ %s`, (status) => {
      expect(canDo(action, status)).toBe(allowed.includes(status));
    });
  }

  it('확정된 일기는 다시 분석할 수 없다 (409 INVALID_ENTRY_STATE, 현재 상태 포함)', () => {
    try {
      assertCanDo('analyze', 'CONFIRMED');
      throw new Error('통과하면 안 된다');
    } catch (e) {
      expect(e).toBeInstanceOf(AppException);
      expect((e as AppException).code).toBe('INVALID_ENTRY_STATE');
      expect((e as AppException).getStatus()).toBe(409);
      expect((e as AppException).details).toEqual({
        status: 'CONFIRMED',
        action: 'analyze',
      });
    }
  });
});
