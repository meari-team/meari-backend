import { Module } from '@nestjs/common';
import { EntriesController } from './entries.controller.js';
import { EntriesService } from './entries.service.js';
import { GenerationController } from './generation.controller.js';
import { GenerationService } from '../generation/generation.service.js';
import { PhotosService } from '../photos/photos.service.js';
import { PhotosController } from './photos.controller.js';
import { SchedulesModule } from '../schedules/schedules.module.js';

@Module({
  imports: [SchedulesModule],
  controllers: [EntriesController, PhotosController, GenerationController],
  providers: [EntriesService, PhotosService, GenerationService],
  exports: [EntriesService],
})
export class EntriesModule {}
