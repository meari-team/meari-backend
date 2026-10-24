import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiClient } from './ai-client.service.js';
import { MockAiClient } from './mock-ai-client.js';

@Global()
@Module({
  providers: [
    {
      provide: AiClient,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        config.get('AI_MOCK') === 'true'
          ? new MockAiClient(config)
          : new AiClient(config),
    },
  ],
  exports: [AiClient],
})
export class AiClientModule {}
