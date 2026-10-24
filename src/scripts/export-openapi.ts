// openapi.json을 생성한다. DB 연결 없이 동작하도록 필수 환경변수가 없으면 자리표시 값을 넣는다.
// 사용: npm run openapi:export
import { writeFileSync } from 'node:fs';
import { NestFactory } from '@nestjs/core';

process.env.DATABASE_URL ??= 'postgresql://openapi@localhost:5432/openapi';
process.env.JWT_SECRET ??= 'openapi-export-only';

const { AppModule } = await import('../app.module.js');
const { configureApp } = await import('../app.setup.js');
const { buildOpenApiDocument } = await import('../swagger.js');

const app = configureApp(
  await NestFactory.create(AppModule, { logger: ['error'] }),
);
await app.init();
const doc = buildOpenApiDocument(app);
writeFileSync('openapi.json', `${JSON.stringify(doc, null, 2)}\n`);
await app.close();
console.log(`openapi.json: ${Object.keys(doc.paths).length} paths`);
