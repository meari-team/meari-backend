import { corsOptions } from './cors.js';

const allows = (origin: unknown, value: string) =>
  origin instanceof RegExp
    ? origin.test(value)
    : Array.isArray(origin) && origin.includes(value);

describe('corsOptions', () => {
  it('개발 환경 기본값: localhost·127.0.0.1의 모든 포트만', () => {
    const { origin } = corsOptions({})!;
    expect(allows(origin, 'http://localhost:8081')).toBe(true);
    expect(allows(origin, 'http://127.0.0.1:19006')).toBe(true);
    expect(allows(origin, 'http://localhost')).toBe(true);
    expect(allows(origin, 'https://evil.example')).toBe(false);
    expect(allows(origin, 'http://localhost.evil.example')).toBe(false);
  });

  it('운영 환경에서 목록이 없으면 CORS를 열지 않는다', () => {
    expect(corsOptions({ NODE_ENV: 'production' })).toBeNull();
  });

  it('CORS_ORIGINS가 있으면 그 목록만 (끝 슬래시·공백 정리)', () => {
    const { origin } = corsOptions({
      NODE_ENV: 'production',
      CORS_ORIGINS: ' https://meari.app/ , https://admin.meari.app',
    })!;
    expect(origin).toEqual(['https://meari.app', 'https://admin.meari.app']);
  });

  it('쿠키 자격 증명은 쓰지 않고 Retry-After를 노출한다', () => {
    const opts = corsOptions({})!;
    expect(opts.credentials).toBe(false);
    expect(opts.exposedHeaders).toContain('Retry-After');
  });
});
