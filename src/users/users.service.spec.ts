import { compare, hash } from 'bcryptjs';
import type { AiClient } from '../ai-client/ai-client.service.js';
import { PASSWORD_PATTERN } from '../auth/password-policy.js';
import { AppException } from '../common/errors/app.exception.js';
import type { MemorySyncService } from '../memory-sync/memory-sync.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { PhotoStorage } from '../storage/photo-storage.js';
import { UsersService } from './users.service.js';

describe('비밀번호 규칙', () => {
  it('8~64자, 영문·숫자 각 1자 이상', () => {
    expect(PASSWORD_PATTERN.test('abcd1234')).toBe(true);
    expect(PASSWORD_PATTERN.test('abcdefgh')).toBe(false);
    expect(PASSWORD_PATTERN.test('12345678')).toBe(false);
    expect(PASSWORD_PATTERN.test('abc123')).toBe(false);
    expect(PASSWORD_PATTERN.test(`a1${'x'.repeat(63)}`)).toBe(false);
  });
});

describe('UsersService.changePassword', () => {
  // DB 대역: 한 사용자의 해시만 들고 있다
  const setup = async (current: string) => {
    const db = { passwordHash: await hash(current, 4) };
    const prisma = {
      user: {
        findUnique: () => Promise.resolve({ ...db }),
        update: ({ data }: { data: { passwordHash: string } }) => {
          db.passwordHash = data.passwordHash;
          return Promise.resolve(db);
        },
      },
    } as unknown as PrismaService;
    const service = new UsersService(
      prisma,
      {} as AiClient,
      {} as MemorySyncService,
      {} as PhotoStorage,
    );
    return { db, service };
  };

  const codeOf = (e: unknown) => (e instanceof AppException ? e.code : e);

  it('지금 비밀번호가 맞으면 새 비밀번호로 바꾼다', async () => {
    const { db, service } = await setup('abcd1234');
    await service.changePassword('u1', {
      currentPassword: 'abcd1234',
      newPassword: 'newpass99',
    });
    expect(await compare('newpass99', db.passwordHash)).toBe(true);
  });

  it('규칙 이전의 짧은 비밀번호(시연 계정 test)도 바꿀 수 있다', async () => {
    const { db, service } = await setup('test');
    await service.changePassword('u1', {
      currentPassword: 'test',
      newPassword: 'newpass99',
    });
    expect(await compare('newpass99', db.passwordHash)).toBe(true);
  });

  it('지금 비밀번호가 틀리면 WRONG_PASSWORD(400)이고 바꾸지 않는다', async () => {
    const { db, service } = await setup('abcd1234');
    const before = db.passwordHash;
    const err = await service
      .changePassword('u1', {
        currentPassword: 'wrong1234',
        newPassword: 'newpass99',
      })
      .catch((e: unknown) => e);
    expect(codeOf(err)).toBe('WRONG_PASSWORD');
    expect((err as AppException).getStatus()).toBe(400);
    expect(db.passwordHash).toBe(before);
  });

  it('지금과 같은 비밀번호면 SAME_PASSWORD', async () => {
    const { service } = await setup('abcd1234');
    const err = await service
      .changePassword('u1', {
        currentPassword: 'abcd1234',
        newPassword: 'abcd1234',
      })
      .catch((e: unknown) => e);
    expect(codeOf(err)).toBe('SAME_PASSWORD');
  });
});
