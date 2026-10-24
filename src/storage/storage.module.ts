import { Global, Module } from '@nestjs/common';
import { FilesController } from './files.controller.js';
import { LocalPhotoStorage } from './local-photo-storage.js';
import { PhotoStorage } from './photo-storage.js';

@Global()
@Module({
  controllers: [FilesController],
  providers: [
    LocalPhotoStorage,
    { provide: PhotoStorage, useExisting: LocalPhotoStorage },
  ],
  exports: [PhotoStorage],
})
export class StorageModule {}
