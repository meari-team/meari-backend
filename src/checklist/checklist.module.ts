import { Module } from '@nestjs/common';
import { ChecklistController } from './checklist.controller.js';

@Module({
  controllers: [ChecklistController],
})
export class ChecklistModule {}
