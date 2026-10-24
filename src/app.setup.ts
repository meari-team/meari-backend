import type { INestApplication } from '@nestjs/common';
import { HttpExceptionFilter } from './common/errors/http-exception.filter.js';
import { createValidationPipe } from './common/validation.js';

// main.ts와 e2e 테스트가 같은 설정으로 앱을 띄우도록 한곳에 모은다.
export function configureApp(app: INestApplication) {
  app.setGlobalPrefix('api/v1', { exclude: ['health'] });
  app.useGlobalPipes(createValidationPipe());
  app.useGlobalFilters(new HttpExceptionFilter());
  app.enableShutdownHooks();
  return app;
}
