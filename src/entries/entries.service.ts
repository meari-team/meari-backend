import { HttpStatus, Injectable } from '@nestjs/common';
import { AiClient } from '../ai-client/ai-client.service.js';
import { toDbDate } from '../common/dates.js';
import { AppException } from '../common/errors/app.exception.js';
import { MemorySyncService } from '../memory-sync/memory-sync.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PhotoStorage } from '../storage/photo-storage.js';
import type {
  EntryDto,
  EntryFeedDto,
  EntrySummaryDto,
  UpsertEntryDto,
} from './entries.dto.js';
import {
  entryDetailInclude,
  entryFeedInclude,
  entrySummaryInclude,
  toEntryDto,
  toEntryFeedItemDto,
  toEntrySummaryDto,
} from './entry.mapper.js';

export const entryNotFound = () =>
  new AppException(
    'ENTRY_NOT_FOUND',
    HttpStatus.NOT_FOUND,
    '일기를 찾을 수 없어요.',
  );

@Injectable()
export class EntriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: PhotoStorage,
    private readonly ai: AiClient,
    private readonly memorySync: MemorySyncService,
  ) {}

  async listRange(
    userId: string,
    from: string,
    to: string,
  ): Promise<EntrySummaryDto[]> {
    const entries = await this.prisma.entry.findMany({
      where: { userId, entryDate: { gte: toDbDate(from), lte: toDbDate(to) } },
      orderBy: { entryDate: 'asc' },
      include: entrySummaryInclude,
    });
    return Promise.all(entries.map((e) => toEntrySummaryDto(e, this.storage)));
  }

  // 전체 일기 목록(날짜 내림차순). before 미만만, limit+1개를 읽어 다음 페이지 여부를 안다
  async feed(
    userId: string,
    before: string | undefined,
    limit: number,
  ): Promise<EntryFeedDto> {
    const rows = await this.prisma.entry.findMany({
      where: {
        userId,
        ...(before ? { entryDate: { lt: toDbDate(before) } } : {}),
      },
      orderBy: { entryDate: 'desc' },
      take: limit + 1,
      include: entryFeedInclude,
    });
    const page = rows.slice(0, limit);
    const items = await Promise.all(
      page.map((e) => toEntryFeedItemDto(e, this.storage)),
    );
    return {
      items,
      nextBefore: rows.length > limit ? items[items.length - 1].date : null,
    };
  }

  // 남의 일기와 없는 일기를 구분하지 않는다 (둘 다 404).
  async get(userId: string, date: string): Promise<EntryDto> {
    const entry = await this.prisma.entry.findUnique({
      where: { userId_entryDate: { userId, entryDate: toDbDate(date) } },
      include: entryDetailInclude,
    });
    if (!entry) throw entryNotFound();
    return toEntryDto(entry, this.storage);
  }

  async upsert(
    userId: string,
    date: string,
    dto: UpsertEntryDto,
  ): Promise<{ created: boolean; entry: EntryDto }> {
    const itemIds = dto.checkedItemIds
      ? [...new Set(dto.checkedItemIds)]
      : undefined;
    if (itemIds && itemIds.length > 0) {
      const owned = await this.prisma.checklistItem.count({
        where: { id: { in: itemIds }, category: { userId } },
      });
      if (owned !== itemIds.length) {
        throw new AppException(
          'VALIDATION_FAILED',
          HttpStatus.BAD_REQUEST,
          '체크리스트 항목을 확인해 주세요.',
          [{ field: 'checkedItemIds', reasons: ['notOwned'] }],
        );
      }
    }

    const key = { userId_entryDate: { userId, entryDate: toDbDate(date) } };
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.entry.findUnique({
        where: key,
        select: { id: true },
      });
      // note: undefined면 그대로, null이면 지운다
      const noteUpdate = dto.note === undefined ? {} : { note: dto.note };

      const entry = existing
        ? await tx.entry.update({
            where: key,
            data: noteUpdate,
            select: { id: true },
          })
        : await tx.entry.create({
            data: { userId, entryDate: toDbDate(date), ...noteUpdate },
            select: { id: true },
          });

      if (itemIds) {
        await tx.entryCheck.deleteMany({ where: { entryId: entry.id } });
        await tx.entryCheck.createMany({
          data: itemIds.map((itemId) => ({ entryId: entry.id, itemId })),
        });
      }

      const full = await tx.entry.findUniqueOrThrow({
        where: { id: entry.id },
        include: entryDetailInclude,
      });
      return {
        created: !existing,
        entry: await toEntryDto(full, this.storage),
      };
    });
  }

  // ADR-006: AI 색인을 먼저 지우고, 성공해야 DB에서 지운다.
  // "지웠는데 과거의 나가 기억하는" 상황을 막기 위해 AI 실패 시 503으로 멈춘다.
  // 진행 중인 색인과 겹치지 않도록 같은 일기의 동기화 순서 안에서 실행한다.
  async remove(userId: string, date: string): Promise<void> {
    const found = await this.prisma.entry.findUnique({
      where: { userId_entryDate: { userId, entryDate: toDbDate(date) } },
      select: { id: true },
    });
    if (!found) throw entryNotFound();

    const keys = await this.memorySync.exclusive(found.id, async () => {
      const entry = await this.prisma.entry.findUnique({
        where: { id: found.id },
        select: {
          status: true,
          aiIndexStatus: true,
          photos: { select: { storageKey: true } },
        },
      });
      if (!entry) throw entryNotFound();
      // 한 번이라도 확정됐다면 색인됐을 수 있다 (DELETE는 멱등)
      if (entry.status === 'CONFIRMED' || entry.aiIndexStatus !== 'NONE') {
        await this.ai.deleteDiaryIndex(userId, found.id);
      }
      await this.prisma.entry.delete({ where: { id: found.id } });
      return entry.photos.map((p) => p.storageKey);
    });
    await this.storage.remove(keys);
  }
}
