import { Global, Module } from '@nestjs/common';
import { MemorySyncService } from './memory-sync.service.js';

@Global()
@Module({
  providers: [MemorySyncService],
  exports: [MemorySyncService],
})
export class MemorySyncModule {}
