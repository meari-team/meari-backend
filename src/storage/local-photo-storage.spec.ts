import type { ConfigService } from '@nestjs/config';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalPhotoStorage, photoKey } from './local-photo-storage.js';

const USER = '11111111-1111-4111-8111-111111111111';
const PHOTO = '22222222-2222-4222-8222-222222222222';

describe('LocalPhotoStorage', () => {
  let dir: string;
  let storage: LocalPhotoStorage;
  const key = photoKey(USER, '2026-10-24', PHOTO);

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'meari-storage-'));
    const values: Record<string, string> = {
      STORAGE_LOCAL_DIR: dir,
      PUBLIC_BASE_URL: 'http://api.test/',
      JWT_SECRET: 'test-secret',
    };
    const config = {
      get: (k: string, d?: string) => values[k] ?? d,
      getOrThrow: (k: string) => values[k],
    } as unknown as ConfigService;
    storage = new LocalPhotoStorage(config);
    await storage.put(key, Buffer.from('jpeg-bytes'));
  });

  afterEach(() => rm(dir, { recursive: true, force: true }));

  const parse = (url: string) => {
    const u = new URL(url);
    return {
      token: u.pathname.split('/').pop() ?? '',
      exp: u.searchParams.get('exp') ?? '',
      sig: u.searchParams.get('sig') ?? '',
      base: `${u.origin}${u.pathname.split('/').slice(0, -1).join('/')}`,
    };
  };

  it('저장한 파일을 서명된 URL로 다시 찾는다', async () => {
    const url = (await storage.signedUrl(key))!;
    const { token, exp, sig, base } = parse(url);
    expect(base).toBe('http://api.test/api/v1/files');

    const file = await storage.resolveSigned(token, exp, sig);
    expect(file).not.toBeNull();
    expect(await readFile(file!.path, 'utf8')).toBe('jpeg-bytes');
  });

  it('10분 안에 다시 서명하면 같은 URL (앱 이미지 캐시용)', async () => {
    const t = Date.UTC(2026, 9, 24, 3, 1);
    expect(await storage.signedUrl(key, t)).toBe(
      await storage.signedUrl(key, t + 60_000),
    );
  });

  it('만료된 URL은 거부한다', async () => {
    const { token, exp, sig } = parse((await storage.signedUrl(key))!);
    const later = (Number(exp) + 1) * 1000;
    expect(await storage.resolveSigned(token, exp, sig, later)).toBeNull();
  });

  it('서명·만료 시각·키를 바꾸면 거부한다', async () => {
    const { token, exp, sig } = parse((await storage.signedUrl(key))!);
    const otherKey = Buffer.from(
      photoKey(USER, '2026-10-24', '33333333-3333-4333-8333-333333333333'),
    ).toString('base64url');

    expect(
      await storage.resolveSigned(token, exp, `${sig.slice(0, -1)}A`),
    ).toBeNull();
    expect(
      await storage.resolveSigned(token, String(Number(exp) + 600), sig),
    ).toBeNull();
    expect(await storage.resolveSigned(otherKey, exp, sig)).toBeNull();
  });

  it('형식이 다른 키(경로 조작)는 서명이 맞아도 거부한다', async () => {
    const evil = '../../etc/passwd';
    const url = (await storage.signedUrl(evil).catch(() => null)) ?? null;
    if (url) {
      const { token, exp, sig } = parse(url);
      expect(await storage.resolveSigned(token, exp, sig)).toBeNull();
    }
    await expect(storage.put(evil, Buffer.from('x'))).rejects.toThrow();
  });

  it('삭제하면 더 이상 찾을 수 없고, 없는 파일 삭제도 에러가 아니다', async () => {
    const { token, exp, sig } = parse((await storage.signedUrl(key))!);
    await storage.remove([key, key]);
    expect(await storage.resolveSigned(token, exp, sig)).toBeNull();
  });
});
