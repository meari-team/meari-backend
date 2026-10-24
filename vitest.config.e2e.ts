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
    },
  },
});
