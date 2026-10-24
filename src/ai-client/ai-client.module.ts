import { Global, Module } from '@nestjs/common';
import { AiClient } from './ai-client.service.js';

@Global()
@Module({
  providers: [AiClient],
  exports: [AiClient],
})
export class AiClientModule {}
