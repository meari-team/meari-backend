import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ErrorResponseDto } from './common/swagger/api-docs.js';

export function buildOpenApiDocument(app: INestApplication) {
  const config = new DocumentBuilder()
    .setTitle('메아리 API')
    .setDescription('앱 ↔ NestJS API. 설계 문서: meari-docs/api.md')
    .setVersion('0.1.0')
    .addBearerAuth()
    .addSecurityRequirements('bearer')
    .build();
  return SwaggerModule.createDocument(app, config, {
    extraModels: [ErrorResponseDto],
  });
}

// /docs (UI), /docs-json (OpenAPI JSON)
export function setupSwagger(app: INestApplication) {
  SwaggerModule.setup('docs', app, buildOpenApiDocument(app), {
    jsonDocumentUrl: 'docs-json',
  });
}
