import { Module } from '@nestjs/common';
import { ChatController } from './chat.controller.js';
import { PastSelfController } from './past-self.controller.js';

@Module({
  controllers: [PastSelfController, ChatController],
})
export class PastSelfModule {}
