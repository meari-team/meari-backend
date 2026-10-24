// 확정된 일기를 AI 서버에 다시 색인한다.
//   npm run memory:reindex           # PENDING·FAILED만
//   npm run memory:reindex -- --all  # 확정된 일기 전부 (AI 저장소를 새로 만들었을 때)
import { NestFactory } from '@nestjs/core';

process.env.MEMORY_SYNC_ON_BOOT = 'false';

const { AppModule } = await import('../app.module.js');
const { MemorySyncService } =
  await import('../memory-sync/memory-sync.service.js');

const app = await NestFactory.createApplicationContext(AppModule, {
  logger: ['log', 'warn', 'error'],
});
const result = await app.get(MemorySyncService).reindex({
  all: process.argv.includes('--all'),
});
console.log(JSON.stringify(result));
await app.close();
process.exit(result.failed > 0 ? 1 : 0);
