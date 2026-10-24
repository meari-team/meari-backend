import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { toDbDate } from '../common/dates.js';
import { AppException } from '../common/errors/app.exception.js';
import type { PhotoDto, UpdatePhotoDto } from '../entries/entries.dto.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { photoKey } from '../storage/local-photo-storage.js';
import { PhotoStorage } from '../storage/photo-storage.js';
import { processPhoto } from './photo-processor.js';

export const MAX_PHOTOS_PER_ENTRY = 3; // AI 서버 분석 한도
const MAX_CAPTION = 100;

export type UploadedFile = { buffer: Buffer; size: number };

const photoNotFound = () =>
  new AppException(
    'PHOTO_NOT_FOUND',
    HttpStatus.NOT_FOUND,
    '사진을 찾을 수 없어요.',
  );

function parseCaptions(
  raw: string | undefined,
  count: number,
): (string | null)[] {
  if (raw === undefined || raw === '') return Array<null>(count).fill(null);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length > count ||
    !parsed.every((c) => typeof c === 'string' && c.length <= MAX_CAPTION)
  ) {
    throw new AppException(
      'VALIDATION_FAILED',
      HttpStatus.BAD_REQUEST,
      '캡션 형식을 확인해 주세요.',
      [
        {
          field: 'captions',
          reasons: ['jsonStringArray', `maxLength${MAX_CAPTION}`],
        },
      ],
    );
  }
  return Array.from({ length: count }, (_, i) => {
    const c = (parsed as string[])[i]?.trim();
    return c ? c : null;
  });
}

// 사진이 바뀌면 이전 분석·질문은 더 이상 맞지 않는다.
// 확정 전 일기는 처음 단계(DRAFT)로 되돌리고, 확정된 일기는 본문을 지키기 위해 상태를 유지한다.
async function resetAfterPhotoChange(
  tx: Prisma.TransactionClient,
  entryId: string,
) {
  const entry = await tx.entry.findUniqueOrThrow({
    where: { id: entryId },
    select: { status: true },
  });
  await tx.entryQuestion.deleteMany({ where: { entryId } });
  await tx.entry.update({
    where: { id: entryId },
    data: {
      // Json 컬럼을 SQL NULL로 (null 리터럴은 Json 값으로 저장될 수 있다)
      imageAnalysis: Prisma.DbNull,
      ...(entry.status === 'CONFIRMED' ? {} : { status: 'DRAFT' }),
    },
  });
}

// 정렬 순서를 0부터 빈틈 없이 다시 매긴다
async function renumber(tx: Prisma.TransactionClient, orderedIds: string[]) {
  for (const [i, id] of orderedIds.entries()) {
    await tx.photo.update({ where: { id }, data: { sortOrder: i } });
  }
}

@Injectable()
export class PhotosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: PhotoStorage,
  ) {}

  async upload(
    userId: string,
    date: string,
    files: UploadedFile[],
    captionsRaw?: string,
  ): Promise<PhotoDto[]> {
    if (files.length === 0) {
      throw new AppException(
        'VALIDATION_FAILED',
        HttpStatus.BAD_REQUEST,
        '사진을 1장 이상 올려 주세요.',
        [{ field: 'files', reasons: ['required'] }],
      );
    }
    const captions = parseCaptions(captionsRaw, files.length);
    const entryKey = {
      userId_entryDate: { userId, entryDate: toDbDate(date) },
    };

    const existing = await this.prisma.entry.findUnique({
      where: entryKey,
      select: { _count: { select: { photos: true } } },
    });
    this.assertWithinLimit((existing?._count.photos ?? 0) + files.length);

    // DB에 쓰기 전에 모든 사진을 검증·변환한다 (하나라도 실패하면 아무것도 저장하지 않음)
    const processed = await Promise.all(
      files.map((f) => processPhoto(f.buffer)),
    );
    const ids = processed.map(() => randomUUID());
    const keys = ids.map((id) => photoKey(userId, date, id));
    await Promise.all(
      keys.map((key, i) => this.storage.put(key, processed[i].data)),
    );

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const entry = await tx.entry.upsert({
          where: entryKey,
          create: { userId, entryDate: toDbDate(date) },
          update: {},
          select: { id: true, _count: { select: { photos: true } } },
        });
        // 동시에 올린 요청까지 고려해 트랜잭션 안에서 다시 확인한다
        const base = entry._count.photos;
        this.assertWithinLimit(base + files.length);

        await tx.photo.createMany({
          data: processed.map((p, i) => ({
            id: ids[i],
            entryId: entry.id,
            userId,
            storageKey: keys[i],
            width: p.width,
            height: p.height,
            caption: captions[i],
            sortOrder: base + i,
          })),
        });
        await resetAfterPhotoChange(tx, entry.id);
        return tx.photo.findMany({
          where: { id: { in: ids } },
          orderBy: { sortOrder: 'asc' },
        });
      });
      return Promise.all(created.map((p) => this.toDto(p)));
    } catch (e) {
      await this.storage.remove(keys);
      throw e;
    }
  }

  async update(
    userId: string,
    date: string,
    photoId: string,
    dto: UpdatePhotoDto,
  ): Promise<PhotoDto> {
    const photo = await this.findOwned(userId, date, photoId);

    const updated = await this.prisma.$transaction(async (tx) => {
      if (dto.caption !== undefined) {
        const caption = dto.caption.trim();
        await tx.photo.update({
          where: { id: photo.id },
          data: { caption: caption || null },
        });
      }
      if (dto.sortOrder !== undefined) {
        const siblings = await tx.photo.findMany({
          where: { entryId: photo.entryId },
          orderBy: { sortOrder: 'asc' },
          select: { id: true },
        });
        const order = siblings.map((s) => s.id).filter((id) => id !== photo.id);
        order.splice(Math.min(dto.sortOrder, order.length), 0, photo.id);
        await renumber(tx, order);
      }
      return tx.photo.findUniqueOrThrow({ where: { id: photo.id } });
    });
    return this.toDto(updated);
  }

  async remove(userId: string, date: string, photoId: string): Promise<void> {
    const photo = await this.findOwned(userId, date, photoId);
    await this.prisma.$transaction(async (tx) => {
      await tx.photo.delete({ where: { id: photo.id } });
      const rest = await tx.photo.findMany({
        where: { entryId: photo.entryId },
        orderBy: { sortOrder: 'asc' },
        select: { id: true },
      });
      await renumber(
        tx,
        rest.map((r) => r.id),
      );
      await resetAfterPhotoChange(tx, photo.entryId);
    });
    await this.storage.remove([photo.storageKey]);
  }

  // 사진 ID만으로 찾지 않고 소유자·날짜까지 맞아야 한다 (IDOR 방지)
  private async findOwned(userId: string, date: string, photoId: string) {
    const photo = await this.prisma.photo.findFirst({
      where: { id: photoId, userId, entry: { entryDate: toDbDate(date) } },
    });
    if (!photo) throw photoNotFound();
    return photo;
  }

  private assertWithinLimit(total: number) {
    if (total > MAX_PHOTOS_PER_ENTRY) {
      throw new AppException(
        'PHOTO_LIMIT_EXCEEDED',
        HttpStatus.UNPROCESSABLE_ENTITY,
        `사진은 하루 ${MAX_PHOTOS_PER_ENTRY}장까지 올릴 수 있어요.`,
        { max: MAX_PHOTOS_PER_ENTRY },
      );
    }
  }

  private async toDto(p: {
    id: string;
    storageKey: string;
    width: number | null;
    height: number | null;
    caption: string | null;
    sortOrder: number;
  }): Promise<PhotoDto> {
    return {
      id: p.id,
      url: (await this.storage.signedUrl(p.storageKey)) ?? '',
      width: p.width,
      height: p.height,
      caption: p.caption,
      sortOrder: p.sortOrder,
    };
  }
}
