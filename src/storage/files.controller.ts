import {
  Controller,
  Get,
  Header,
  HttpStatus,
  Param,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Response } from 'express';
import { createReadStream } from 'node:fs';
import { Public } from '../common/decorators/public.decorator.js';
import { AppException } from '../common/errors/app.exception.js';
import { LocalPhotoStorage } from './local-photo-storage.js';

// 서명된 사진 URL을 처리한다. 토큰 대신 서명으로 인가하므로 @Public.
// 서명이 틀리거나 만료됐거나 파일이 없으면 구분 없이 404.
@ApiExcludeController()
@Public()
@Controller('files')
export class FilesController {
  constructor(private readonly storage: LocalPhotoStorage) {}

  @Get(':token')
  @Header('Content-Type', 'image/jpeg')
  @Header('X-Content-Type-Options', 'nosniff')
  async get(
    @Param('token') token: string,
    @Query('exp') exp: string,
    @Query('sig') sig: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const file = await this.storage.resolveSigned(token, exp ?? '', sig ?? '');
    if (!file) {
      throw new AppException(
        'NOT_FOUND',
        HttpStatus.NOT_FOUND,
        '찾을 수 없어요.',
      );
    }
    res.setHeader('Cache-Control', `private, max-age=${file.maxAgeSec}`);
    return new StreamableFile(createReadStream(file.path));
  }
}
