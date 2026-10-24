import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { AiClient } from '../ai-client/ai-client.service.js';
import { AppException } from '../common/errors/app.exception.js';
import { MemorySyncService } from '../memory-sync/memory-sync.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PhotoStorage } from '../storage/photo-storage.js';
import { toUserDto, type UserDto } from './user.dto.js';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiClient,
    private readonly memorySync: MemorySyncService,
    private readonly storage: PhotoStorage,
  ) {}

  async me(userId: string): Promise<UserDto> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new AppException(
        'UNAUTHORIZED',
        HttpStatus.UNAUTHORIZED,
        '로그인이 필요해요.',
      );
    }
    return toUserDto(user);
  }

  // U3 회원 탈퇴 (ADR-006): AI 기억을 먼저 모두 지우고, 하나라도 실패하면 아무것도 지우지 않는다.
  // 이미 AI에서 지운 일기는 PENDING으로 되돌려, 탈퇴가 취소된 상태와 AI 복제본을 다시 맞춘다.
  async withdraw(userId: string): Promise<void> {
    const indexed = await this.prisma.entry.findMany({
      where: {
        userId,
        OR: [{ status: 'CONFIRMED' }, { aiIndexStatus: { not: 'NONE' } }],
      },
      select: { id: true, status: true, excludedFromMemory: true },
    });

    const removed: string[] = [];
    try {
      for (const entry of indexed) {
        await this.memorySync.exclusive(entry.id, () =>
          this.ai.deleteDiaryIndex(userId, entry.id),
        );
        removed.push(entry.id);
      }
    } catch (e) {
      const restore = indexed.filter(
        (en) =>
          removed.includes(en.id) &&
          en.status === 'CONFIRMED' &&
          !en.excludedFromMemory,
      );
      if (restore.length > 0) {
        await this.prisma.entry.updateMany({
          where: { id: { in: restore.map((r) => r.id) } },
          data: { aiIndexStatus: 'PENDING' },
        });
        restore.forEach((r) => this.memorySync.schedule(r.id));
      }
      this.logger.warn(
        JSON.stringify({
          event: 'withdraw_aborted',
          removed: removed.length,
          total: indexed.length,
        }),
      );
      throw e;
    }

    const photos = await this.prisma.photo.findMany({
      where: { userId },
      select: { storageKey: true },
    });
    await this.prisma.user.delete({ where: { id: userId } });
    await this.storage.remove(photos.map((p) => p.storageKey));
  }
}
