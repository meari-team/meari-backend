import { Module } from '@nestjs/common';
import { EntriesController } from './entries.controller.js';
import { GenerationController } from './generation.controller.js';
import { PhotosController } from './photos.controller.js';

@Module({
  controllers: [EntriesController, PhotosController, GenerationController],
})
export class EntriesModule {}
