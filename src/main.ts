import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';
import { setupSwagger } from './swagger.js';

async function bootstrap() {
  const app = configureApp(await NestFactory.create(AppModule));
  if (process.env.SWAGGER_ENABLED !== 'false') setupSwagger(app);
  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
