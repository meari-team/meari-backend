import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiClientError } from '../ai-client/ai-client.error.js';
import { AiClient } from '../ai-client/ai-client.service.js';
import { fromDbDate } from '../common/dates.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { KeyedLock } from './keyed-lock.js';

export type SyncOutcome = 'indexed' | 'failed' | 'skipped' | 'gone';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// 확정된 일기(메인 DB 원본)를 AI 서버 검색 복제본에 반영한다 (ADR-005).
// - 확정 → PENDING → (색인) → INDEXED / 재시도 후 FAILED
// - 같은 일기의 색인·삭제는 KeyedLock으로 순서대로 실행한다
//   (늦게 도착한 색인이 삭제된 일기를 되살리지 않도록)
// - 재시도할 때마다 DB에서 최신 본문을 다시 읽는다
// - 서버가 뜰 때 PENDING·FAILED를 다시 처리한다
@Injectable()
export class MemorySyncService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(MemorySyncService.name);
  private readonly lock = new KeyedLock();
  private readonly inflight = new Set<Promise<unknown>>();
  private readonly retryDelaysMs: number[];
  private readonly syncOnBoot: boolean;

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiClient,
    config: ConfigService,
  ) {
    this.retryDelaysMs = String(
      config.get('MEMORY_SYNC_RETRY_DELAYS_MS', '1000,2000,4000,8000'),
    )
      .split(',')
      .map(Number)
      .filter((n) => Number.isFinite(n) && n >= 0);
    this.syncOnBoot = config.get('MEMORY_SYNC_ON_BOOT', 'true') !== 'false';
  }

  onApplicationBootstrap() {
    if (!this.syncOnBoot) return;
    this.track(
      this.reindex().then((r) => {
        if (r.total > 0)
          this.logger.log(`부팅 시 색인 재처리: ${JSON.stringify(r)}`);
      }),
    );
  }

  async onApplicationShutdown() {
    await this.waitForIdle();
  }

  // 응답을 막지 않고 뒤에서 색인한다 (확정 API에서 호출)
  schedule(entryId: string): void {
    this.track(this.sync(entryId));
  }

  sync(entryId: string): Promise<SyncOutcome> {
    return this.lock.run(entryId, () => this.syncLocked(entryId));
  }

  // 같은 일기의 색인 작업과 겹치지 않게 실행한다 (일기 삭제·기억에서 제외)
  exclusive<T>(entryId: string, task: () => Promise<T>): Promise<T> {
    return this.lock.run(entryId, task);
  }

  // all=false: PENDING·FAILED만, all=true: 확정·미제외 전부 (AI 저장소 복구용)
  async reindex(opts: { all?: boolean } = {}) {
    const entries = await this.prisma.entry.findMany({
      where: {
        status: 'CONFIRMED',
        excludedFromMemory: false,
        ...(opts.all ? {} : { aiIndexStatus: { in: ['PENDING', 'FAILED'] } }),
      },
      select: { id: true },
      orderBy: { entryDate: 'asc' },
    });
    const result = { total: entries.length, indexed: 0, failed: 0, skipped: 0 };
    for (const { id } of entries) {
      const outcome = await this.sync(id);
      if (outcome === 'indexed') result.indexed++;
      else if (outcome === 'failed') result.failed++;
      else result.skipped++;
    }
    return result;
  }

  async waitForIdle() {
    while (this.inflight.size > 0) {
      await Promise.allSettled(this.inflight);
    }
  }

  private track(p: Promise<unknown>) {
    const tracked = p.catch((e: unknown) => {
      this.logger.error(
        `색인 작업 오류: ${e instanceof Error ? e.name : 'Unknown'}`,
      );
    });
    this.inflight.add(tracked);
    void tracked.finally(() => this.inflight.delete(tracked));
  }

  private async syncLocked(entryId: string): Promise<SyncOutcome> {
    for (let attempt = 0; ; attempt++) {
      const entry = await this.prisma.entry.findUnique({
        where: { id: entryId },
        select: {
          userId: true,
          entryDate: true,
          status: true,
          finalContent: true,
          excludedFromMemory: true,
        },
      });
      if (!entry) return 'gone';
      if (
        entry.status !== 'CONFIRMED' ||
        entry.excludedFromMemory ||
        !entry.finalContent
      ) {
        return 'skipped';
      }

      try {
        await this.ai.indexDiary({
          user_id: entry.userId,
          diary_id: entryId,
          diary_date: fromDbDate(entry.entryDate),
          content: entry.finalContent,
        });
        // 보낸 본문이 아직 최신일 때만 INDEXED로 표시한다.
        // 그 사이 재확정됐다면 PENDING을 그대로 두고, 대기 중인 다음 색인이 처리한다.
        await this.prisma.entry.updateMany({
          where: { id: entryId, finalContent: entry.finalContent },
          data: {
            aiIndexStatus: 'INDEXED',
            aiIndexedAt: new Date(),
            aiIndexError: null,
          },
        });
        return 'indexed';
      } catch (e) {
        const retryable = e instanceof AiClientError && e.retryable;
        if (retryable && attempt < this.retryDelaysMs.length) {
          await sleep(this.retryDelaysMs[attempt]);
          continue;
        }
        await this.prisma.entry.updateMany({
          where: { id: entryId },
          data: { aiIndexStatus: 'FAILED', aiIndexError: errorCodeOf(e) },
        });
        return 'failed';
      }
    }
  }
}

function errorCodeOf(e: unknown): string {
  if (!(e instanceof AiClientError)) return 'internal';
  const f = e.failure;
  return (f.type === 'http' ? (f.aiCode ?? `http_${f.status}`) : f.type).slice(
    0,
    50,
  );
}
