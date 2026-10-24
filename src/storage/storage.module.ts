import { Global, Module } from '@nestjs/common';
import { NoopPhotoStorage, PhotoStorage } from './photo-storage.js';

@Global()
@Module({
  providers: [{ provide: PhotoStorage, useClass: NoopPhotoStorage }],
  exports: [PhotoStorage],
})
export class StorageModule {}
