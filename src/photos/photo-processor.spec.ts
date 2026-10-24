import sharp from 'sharp';
import { AppException } from '../common/errors/app.exception.js';
import { processPhoto } from './photo-processor.js';

const image = (w: number, h: number) =>
  sharp({
    create: { width: w, height: h, channels: 3, background: '#c08060' },
  });

const codeOf = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return (e as AppException).code;
  }
  return null;
};

describe('processPhoto', () => {
  it('EXIF(위치 정보 등)를 지우고 JPEG로 다시 저장한다', async () => {
    const input = await image(400, 300)
      .withExif({ IFD0: { Copyright: 'meari-test', Artist: 'someone' } })
      .jpeg()
      .toBuffer();
    expect((await sharp(input).metadata()).exif).toBeDefined();

    const out = await processPhoto(input);
    const meta = await sharp(out.data).metadata();
    expect(meta.format).toBe('jpeg');
    expect(meta.exif).toBeUndefined();
    expect(out.data.includes(Buffer.from('meari-test'))).toBe(false);
  });

  it('긴 변을 1600px 이하로 줄이고, 작은 사진은 키우지 않는다', async () => {
    const big = await processPhoto(await image(4000, 3000).png().toBuffer());
    expect([big.width, big.height]).toEqual([1600, 1200]);

    const small = await processPhoto(await image(300, 200).webp().toBuffer());
    expect([small.width, small.height]).toEqual([300, 200]);
  });

  it('EXIF 방향 정보대로 회전한 뒤 저장한다', async () => {
    // 가로 400×200 사진 + 방향 6(90도 회전) → 세로 200×400
    const input = await image(400, 200)
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();
    const out = await processPhoto(input);
    expect([out.width, out.height]).toEqual([200, 400]);
  });

  it('이미지가 아닌 파일·GIF는 UNSUPPORTED_MEDIA_TYPE', async () => {
    expect(await codeOf(processPhoto(Buffer.from('not an image')))).toBe(
      'UNSUPPORTED_MEDIA_TYPE',
    );
    const gif = await image(10, 10).gif().toBuffer();
    expect(await codeOf(processPhoto(gif))).toBe('UNSUPPORTED_MEDIA_TYPE');
  });
});
