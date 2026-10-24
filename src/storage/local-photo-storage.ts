import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { PhotoStorage } from './photo-storage.js';

// users/{userId}/{YYYY-MM-DD}/{photoId}.jpg 형식만 허용한다 (경로 조작 방지)
const KEY_RE = /^users\/[0-9a-f-]{36}\/\d{4}-\d{2}-\d{2}\/[0-9a-f-]{36}\.jpg$/;

const URL_TTL_SEC = 60 * 60;
// 만료 시각을 10분 단위로 맞춰, 같은 사진의 URL이 잠시 동안 같게 유지되도록 한다 (앱 이미지 캐시)
const BUCKET_SEC = 10 * 60;

export const photoKey = (userId: string, date: string, photoId: string) =>
  `users/${userId}/${date}/${photoId}.jpg`;

// Supabase 연결 전까지 쓰는 로컬 디스크 저장소.
// 파일은 비공개로 두고, 서버가 HMAC 서명한 URL(1시간)로만 내려준다 (FilesController).
@Injectable()
export class LocalPhotoStorage extends PhotoStorage {
  private readonly root: string;
  private readonly baseUrl: string;
  private readonly secret: string;

  constructor(config: ConfigService) {
    super();
    this.root = resolve(config.get<string>('STORAGE_LOCAL_DIR', 'uploads'));
    const port = config.get<string>('PORT', '3000');
    this.baseUrl = config
      .get<string>('PUBLIC_BASE_URL', `http://localhost:${port}`)
      .replace(/\/+$/, '');
    this.secret = `photo-url:${config.getOrThrow<string>('JWT_SECRET')}`;
  }

  async put(storageKey: string, data: Buffer): Promise<void> {
    const path = this.pathOf(storageKey);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data);
  }

  read(storageKey: string): Promise<Buffer> {
    return readFile(this.pathOf(storageKey));
  }

  signedUrl(storageKey: string, now = Date.now()): Promise<string | null> {
    const exp = Math.ceil((now / 1000 + URL_TTL_SEC) / BUCKET_SEC) * BUCKET_SEC;
    const token = Buffer.from(storageKey).toString('base64url');
    const sig = this.sign(token, exp);
    return Promise.resolve(
      `${this.baseUrl}/api/v1/files/${token}?exp=${exp}&sig=${sig}`,
    );
  }

  // 서명·만료·키 형식이 모두 맞으면 파일 경로를, 아니면 null을 돌려준다
  async resolveSigned(
    token: string,
    exp: string,
    sig: string,
    now = Date.now(),
  ): Promise<{ path: string; maxAgeSec: number } | null> {
    const expSec = Number(exp);
    if (!Number.isInteger(expSec) || expSec * 1000 <= now) return null;

    const expected = Buffer.from(this.sign(token, expSec));
    const given = Buffer.from(sig);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
      return null;
    }

    const key = Buffer.from(token, 'base64url').toString();
    if (!KEY_RE.test(key)) return null;
    const path = this.pathOf(key);
    try {
      if (!(await stat(path)).isFile()) return null;
    } catch {
      return null;
    }
    return { path, maxAgeSec: Math.floor(expSec - now / 1000) };
  }

  async remove(storageKeys: string[]): Promise<void> {
    await Promise.all(
      storageKeys.map((key) => rm(this.pathOf(key), { force: true })),
    );
  }

  private sign(token: string, exp: number) {
    return createHmac('sha256', this.secret)
      .update(`${token}.${exp}`)
      .digest('base64url');
  }

  private pathOf(storageKey: string) {
    const path = resolve(this.root, storageKey);
    if (!path.startsWith(this.root + sep)) {
      throw new Error('저장소 밖 경로');
    }
    return path;
  }
}
