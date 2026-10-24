import { HttpStatus } from '@nestjs/common';
import sharp from 'sharp';
import { AppException } from '../common/errors/app.exception.js';

export const MAX_PHOTO_BYTES = 4 * 1024 * 1024; // AI 서버 장당 한도와 같다
const MAX_INPUT_PIXELS = 25_000_000; // AI 서버 이미지당 픽셀 한도와 같다
const MAX_EDGE = 1600;
const ALLOWED_FORMATS = new Set(['jpeg', 'png', 'webp']);

export type ProcessedPhoto = { data: Buffer; width: number; height: number };

const unsupported = () =>
  new AppException(
    'UNSUPPORTED_MEDIA_TYPE',
    HttpStatus.UNSUPPORTED_MEDIA_TYPE,
    'JPEG, PNG, WebP 사진만 올릴 수 있어요.',
  );

// 업로드된 파일의 실제 형식을 확인하고(확장자·MIME은 믿지 않는다),
// 회전 보정 → 긴 변 1600px 이하 → JPEG로 다시 인코딩한다.
// 다시 인코딩하면서 EXIF(위치 정보 포함)는 모두 사라진다.
export async function processPhoto(input: Buffer): Promise<ProcessedPhoto> {
  let format: string | undefined;
  try {
    ({ format } = await sharp(input, {
      limitInputPixels: MAX_INPUT_PIXELS,
    }).metadata());
  } catch {
    throw unsupported();
  }
  if (!format || !ALLOWED_FORMATS.has(format)) throw unsupported();

  try {
    const { data, info } = await sharp(input, {
      limitInputPixels: MAX_INPUT_PIXELS,
      failOn: 'error',
    })
      .rotate()
      .resize({
        width: MAX_EDGE,
        height: MAX_EDGE,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({ quality: 80, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });
    return { data, width: info.width, height: info.height };
  } catch {
    throw unsupported();
  }
}
