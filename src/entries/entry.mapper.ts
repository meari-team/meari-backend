import type { Prisma } from '@prisma/client';
import { fromDbDate } from '../common/dates.js';
import type { PhotoStorage } from '../storage/photo-storage.js';
import type {
  EntryDto,
  EntrySummaryDto,
  PhotoDto,
  QuestionDto,
} from './entries.dto.js';

// 상세 조회에 필요한 관계. 정렬까지 여기서 고정한다.
export const entryDetailInclude = {
  photos: { orderBy: { sortOrder: 'asc' } },
  questions: { orderBy: { sortOrder: 'asc' } },
  checks: { select: { itemId: true } },
} satisfies Prisma.EntryInclude;

export type EntryWithDetail = Prisma.EntryGetPayload<{
  include: typeof entryDetailInclude;
}>;

export const entrySummaryInclude = {
  coverPhoto: { select: { storageKey: true } },
  photos: {
    select: { storageKey: true },
    orderBy: { sortOrder: 'asc' },
    take: 1,
  },
  checks: {
    select: { item: { select: { category: { select: { color: true } } } } },
  },
} satisfies Prisma.EntryInclude;

export type EntryWithSummary = Prisma.EntryGetPayload<{
  include: typeof entrySummaryInclude;
}>;

const stringArray = (value: Prisma.JsonValue | null): string[] =>
  Array.isArray(value)
    ? value.filter((v): v is string => typeof v === 'string')
    : [];

const nullableStringArray = (
  value: Prisma.JsonValue | null,
): string[] | null => (Array.isArray(value) ? stringArray(value) : null);

export async function toEntryDto(
  entry: EntryWithDetail,
  storage: PhotoStorage,
): Promise<EntryDto> {
  const photos: PhotoDto[] = await Promise.all(
    entry.photos.map(async (p) => ({
      id: p.id,
      url: (await storage.signedUrl(p.storageKey)) ?? '',
      width: p.width,
      height: p.height,
      caption: p.caption,
      sortOrder: p.sortOrder,
    })),
  );
  const questions: QuestionDto[] = entry.questions.map((q) => ({
    id: q.id,
    question: q.question,
    reason: q.reason,
    options: nullableStringArray(q.options),
    answer: q.answer,
    skipped: q.skipped,
  }));

  return {
    id: entry.id,
    date: fromDbDate(entry.entryDate),
    status: entry.status,
    note: entry.note,
    photos,
    coverPhotoId: entry.coverPhotoId,
    checkedItemIds: entry.checks.map((c) => c.itemId),
    questions,
    aiDraft: entry.aiDraft,
    aiUncertain: stringArray(entry.aiUncertain),
    finalContent: entry.finalContent,
    summary: entry.summary,
    excludedFromMemory: entry.excludedFromMemory,
    aiIndexStatus: entry.aiIndexStatus,
    confirmedAt: entry.confirmedAt?.toISOString() ?? null,
    updatedAt: entry.updatedAt.toISOString(),
  };
}

export async function toEntrySummaryDto(
  entry: EntryWithSummary,
  storage: PhotoStorage,
): Promise<EntrySummaryDto> {
  // 대표 사진이 없으면 첫 번째 사진
  const coverKey = entry.coverPhoto?.storageKey ?? entry.photos[0]?.storageKey;
  return {
    id: entry.id,
    date: fromDbDate(entry.entryDate),
    status: entry.status,
    coverPhotoUrl: coverKey ? await storage.signedUrl(coverKey) : null,
    summary: entry.summary,
    categoryColors: [
      ...new Set(entry.checks.map((c) => c.item.category.color)),
    ],
  };
}
