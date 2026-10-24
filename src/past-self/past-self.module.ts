import { Module } from '@nestjs/common';
import { ChatController } from './chat.controller.js';
import { PastSelfController } from './past-self.controller.js';
import { PastSelfService } from './past-self.service.js';

@Module({
  controllers: [PastSelfController, ChatController],
  providers: [PastSelfService],
})
export class PastSelfModule {}
