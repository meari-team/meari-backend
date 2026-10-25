import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { compare, hash } from 'bcryptjs';
import { AiClient } from '../ai-client/ai-client.service.js';
import { AppException } from '../common/errors/app.exception.js';
import { MemorySyncService } from '../memory-sync/memory-sync.service.js';
import { BCRYPT_COST } from '../auth/password-policy.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PhotoStorage } from '../storage/photo-storage.js';
import {
  toUserDto,
  type ChangePasswordDto,
  type UpdateMeDto,
  type UserDto,
} from './user.dto.js';

const unauthorized = () =>
  new AppException(
    'UNAUTHORIZED',
    HttpStatus.UNAUTHORIZED,
    '로그인이 필요해요.',
  );

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
    if (!user) throw unauthorized();
    return toUserDto(user);
  }

  // U2: 보낸 필드만 바꾼다
  async update(userId: string, dto: UpdateMeDto): Promise<UserDto> {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.nickname !== undefined ? { nickname: dto.nickname } : {}),
        ...(dto.diaryStyle !== undefined ? { diaryStyle: dto.diaryStyle } : {}),
      },
    });
    return toUserDto(user);
  }

  // U4: 비밀번호 변경. 지금 비밀번호가 틀리면 400 WRONG_PASSWORD
  // (401은 앱이 로그아웃으로 처리하므로 쓰지 않는다). 발급된 토큰은 무상태라 만료까지 그대로 유효하다
  async changePassword(userId: string, dto: ChangePasswordDto): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { passwordHash: true },
    });
    if (!user) throw unauthorized();
    if (!(await compare(dto.currentPassword, user.passwordHash))) {
      throw new AppException(
        'WRONG_PASSWORD',
        HttpStatus.BAD_REQUEST,
        '지금 비밀번호가 맞지 않아요.',
      );
    }
    if (dto.newPassword === dto.currentPassword) {
      throw new AppException(
        'SAME_PASSWORD',
        HttpStatus.BAD_REQUEST,
        '지금과 다른 비밀번호를 입력해 주세요.',
      );
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await hash(dto.newPassword, BCRYPT_COST) },
    });
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
