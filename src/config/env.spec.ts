import { validateEnv } from './env.js';

describe('validateEnv', () => {
  const base = { DATABASE_URL: 'postgresql://x', JWT_SECRET: 'secret' };

  it('필수 값이 있으면 그대로 돌려준다', () => {
    expect(validateEnv(base)).toBe(base);
  });

  it('JWT_SECRET이 없으면 부팅을 막는다', () => {
    expect(() => validateEnv({ DATABASE_URL: 'x' })).toThrow('JWT_SECRET');
  });

  it('production에서는 32자 미만 JWT_SECRET을 거부한다', () => {
    expect(() => validateEnv({ ...base, NODE_ENV: 'production' })).toThrow(
      '32자',
    );
    expect(() =>
      validateEnv({
        ...base,
        NODE_ENV: 'production',
        JWT_SECRET: 'x'.repeat(32),
      }),
    ).not.toThrow();
  });
});
