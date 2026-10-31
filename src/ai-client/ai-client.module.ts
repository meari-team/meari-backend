import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service.js';
import { AiClient } from './ai-client.service.js';
import { MockAiClient } from './mock-ai-client.js';

@Global()
@Module({
  providers: [
    {
      provide: AiClient,
      inject: [ConfigService, PrismaService],
      useFactory: (config: ConfigService, prisma: PrismaService) =>
        config.get('AI_MOCK') === 'true'
          ? new MockAiClient(config, prisma)
          : new AiClient(config),
    },
  ],
  exports: [AiClient],
})
export class AiClientModule {}
