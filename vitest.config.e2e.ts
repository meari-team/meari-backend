import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    // e2e는 같은 DB를 쓰므로 파일을 순서대로 돌린다
    fileParallelism: false,
    env: {
      JWT_SECRET: 'e2e-test-secret-e2e-test-secret-0000',
      STORAGE_LOCAL_DIR: '.test-uploads',
      PUBLIC_BASE_URL: 'http://test.local',
      // 테스트는 공유 DB를 쓰므로 부팅 시 재색인을 끄고, 재시도는 기다리지 않는다
      MEMORY_SYNC_ON_BOOT: 'false',
      MEMORY_SYNC_RETRY_DELAYS_MS: '0,0,0,0',
      // 테스트는 한 IP에서 많이 가입·호출하므로 한도를 넉넉히 (제한 자체는 rate-limit.e2e-spec.ts에서 확인)
      RATE_LIMIT_AUTH_PER_MIN: '100000',
      RATE_LIMIT_AI_PER_DAY: '100000',
      RATE_LIMIT_CHAT_PER_HOUR: '100000',
      RATE_LIMIT_DEFAULT_PER_MIN: '100000',
    },
  },
});
