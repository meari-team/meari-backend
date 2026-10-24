import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from './../../src/app.module.js';
import { configureApp } from './../../src/app.setup.js';

export async function createTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = configureApp(moduleRef.createNestApplication());
  await app.init();
  return app;
}

let seq = 0;
export const uniqueEmail = (prefix = 'user') =>
  `${prefix}-${Date.now()}-${seq++}@test.meari`;
