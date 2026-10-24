import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import {
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { ParseDatePipe } from '../common/pipes/parse-date.pipe.js';
import { ApiErrors, ApiStub } from '../common/swagger/api-docs.js';
import { stubPhotos } from '../stubs/fixtures.js';
import {
  PhotoDto,
  PhotoListDto,
  UpdatePhotoDto,
  UploadPhotosDto,
} from './entries.dto.js';

@ApiTags('photos')
@ApiParam({ name: 'date', example: '2026-10-24' })
@ApiErrors({ 401: ['UNAUTHORIZED'] })
@Controller('entries/:date/photos')
export class PhotosController {
  @Post()
  @ApiStub('사진 업로드 (F1) — multipart, 최대 3장', 'MEA-8')
  @ApiConsumes('multipart/form-data')
  @ApiBody({ type: UploadPhotosDto })
  @ApiCreatedResponse({ type: PhotoListDto })
  @ApiErrors({
    413: ['FILE_TOO_LARGE'],
    415: ['UNSUPPORTED_MEDIA_TYPE'],
    422: ['PHOTO_LIMIT_EXCEEDED', 'DATE_IN_FUTURE'],
  })
  upload(@Param('date', ParseDatePipe) date: string): PhotoListDto {
    return { items: stubPhotos(date) };
  }

  @Patch(':photoId')
  @ApiStub('캡션·순서 변경 (F2)', 'MEA-8')
  @ApiOkResponse({ type: PhotoDto })
  @ApiErrors({ 400: ['VALIDATION_FAILED'], 404: ['PHOTO_NOT_FOUND'] })
  update(
    @Param('date', ParseDatePipe) date: string,
    @Param('photoId', ParseUUIDPipe) _photoId: string,
    @Body() dto: UpdatePhotoDto,
  ): PhotoDto {
    const photo = stubPhotos(date)[0];
    return {
      ...photo,
      caption: dto.caption ?? photo.caption,
      sortOrder: dto.sortOrder ?? photo.sortOrder,
    };
  }

  @Delete(':photoId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiStub('사진 삭제 (F3)', 'MEA-8')
  @ApiNoContentResponse()
  @ApiErrors({ 404: ['PHOTO_NOT_FOUND'] })
  remove(
    @Param('date', ParseDatePipe) _date: string,
    @Param('photoId', ParseUUIDPipe) _photoId: string,
  ): void {}
}
