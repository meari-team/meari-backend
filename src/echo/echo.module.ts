import { Module } from '@nestjs/common';
import { EntriesModule } from '../entries/entries.module.js';
import { EchoController } from './echo.controller.js';
import { EchoScheduler } from './echo-scheduler.js';
import { EchoService } from './echo.service.js';
import { PushSender } from './push-sender.js';

@Module({
  imports: [EntriesModule],
  controllers: [EchoController],
  providers: [EchoService, EchoScheduler, PushSender],
})
export class EchoModule {}
