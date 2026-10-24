// 부팅 시 필수 환경변수를 확인한다. 빠진 값이 있으면 서버가 뜨지 않는다.
export function validateEnv(env: Record<string, unknown>) {
  const missing = ['DATABASE_URL', 'JWT_SECRET'].filter((key) => !env[key]);
  if (missing.length > 0) {
    throw new Error(`필수 환경변수가 없습니다: ${missing.join(', ')}`);
  }
  if (env.NODE_ENV === 'production' && String(env.JWT_SECRET).length < 32) {
    throw new Error('JWT_SECRET은 32자 이상이어야 합니다.');
  }
  return env;
}
