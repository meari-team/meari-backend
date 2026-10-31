import { HttpStatus } from '@nestjs/common';
import type { EntryStatus } from '@prisma/client';
import { AppException } from '../common/errors/app.exception.js';

// 일기 상태 머신 (prd.md §7-1)
// DRAFT ─analyze→ QUESTIONING ─answers→ READY ─generate→ GENERATED ─confirm→ CONFIRMED
//   └──── analyze(질문 없음) ───────────────┘          ↑ 재생성        └ 수정 후 재확정
// AI 없이 직접 쓰기: DRAFT·QUESTIONING·READY에서 바로 confirm
export type EntryAction =
  'analyze' | 'answer' | 'generate' | 'skipAndGenerate' | 'confirm';

const ALLOWED: Record<EntryAction, readonly EntryStatus[]> = {
  analyze: ['DRAFT', 'QUESTIONING', 'READY', 'GENERATED'],
  answer: ['QUESTIONING'],
  generate: ['READY', 'GENERATED'],
  // "그냥 생성": 남은 질문을 건너뛰고 생성
  skipAndGenerate: ['QUESTIONING', 'READY', 'GENERATED'],
  // DRAFT·QUESTIONING·READY에서 확정 = AI 초안 없이 직접 쓴 일기 (사진·분석 없이도 바로 쓸 수 있다)
  confirm: ['DRAFT', 'QUESTIONING', 'READY', 'GENERATED', 'CONFIRMED'],
};

export function canDo(action: EntryAction, status: EntryStatus): boolean {
  return ALLOWED[action].includes(status);
}

export function assertCanDo(action: EntryAction, status: EntryStatus): void {
  if (!canDo(action, status)) {
    throw new AppException(
      'INVALID_ENTRY_STATE',
      HttpStatus.CONFLICT,
      '지금 단계에서는 할 수 없는 작업이에요.',
      { status, action },
    );
  }
}
