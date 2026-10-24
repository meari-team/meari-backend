import { Module } from '@nestjs/common';
import { ChecklistController } from './checklist.controller.js';
import { ChecklistService } from './checklist.service.js';

@Module({
  controllers: [ChecklistController],
  providers: [ChecklistService],
})
export class ChecklistModule {}
