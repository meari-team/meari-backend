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
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import {
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import {
  CurrentUser,
  type AuthUser,
} from '../common/decorators/current-user.decorator.js';
import { ParseDatePipe } from '../common/pipes/parse-date.pipe.js';
import { ApiErrors } from '../common/swagger/api-docs.js';
import { MAX_PHOTO_BYTES } from '../photos/photo-processor.js';
import { PhotosService, type UploadedFile } from '../photos/photos.service.js';
import {
  PhotoDto,
  PhotoListDto,
  UpdatePhotoDto,
  UploadPhotosDto,
  uploadPhotosBodySchema,
} from './entries.dto.js';

// multer는 메모리에만 받는다. fileFilter는 쓰지 않는다 (multer <2.5 비동기 fileFilter DoS 회피) —
// 형식 검증은 PhotosService에서 sharp로 실제 내용을 보고 한다.
const uploadInterceptor = FilesInterceptor('files', 10, {
  limits: { fileSize: MAX_PHOTO_BYTES, files: 10, fields: 2, fieldSize: 4096 },
});

@ApiTags('photos')
@ApiParam({ name: 'date', example: '2026-10-24' })
@ApiErrors({ 401: ['UNAUTHORIZED'] })
@Controller('entries/:date/photos')
export class PhotosController {
  constructor(private readonly photos: PhotosService) {}

  @Post()
  @UseInterceptors(uploadInterceptor)
  @ApiOperation({
    summary: '사진 업로드 (F1) — 일기당 최대 3장, 장당 4MB',
    description:
      '일기가 없으면 DRAFT로 만든다. EXIF를 지우고 JPEG(긴 변 1600px 이하)로 다시 저장한다. ' +
      '사진이 바뀌면 이전 분석·질문을 지우고, 확정 전 일기는 DRAFT로 되돌린다.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: uploadPhotosBodySchema })
  @ApiCreatedResponse({ type: PhotoListDto })
  @ApiErrors({
    400: ['VALIDATION_FAILED'],
    413: ['FILE_TOO_LARGE'],
    415: ['UNSUPPORTED_MEDIA_TYPE'],
    422: ['PHOTO_LIMIT_EXCEEDED', 'DATE_IN_FUTURE'],
  })
  async upload(
    @CurrentUser() user: AuthUser,
    @Param('date', ParseDatePipe) date: string,
    @UploadedFiles() files: UploadedFile[] | undefined,
    @Body() body: UploadPhotosDto,
  ): Promise<PhotoListDto> {
    return {
      items: await this.photos.upload(
        user.id,
        date,
        files ?? [],
        body.captions,
      ),
    };
  }

  @Patch(':photoId')
  @ApiOperation({
    summary: '캡션·순서 변경 (F2) — sortOrder를 바꾸면 나머지가 밀린다',
  })
  @ApiOkResponse({ type: PhotoDto })
  @ApiErrors({ 400: ['VALIDATION_FAILED'], 404: ['PHOTO_NOT_FOUND'] })
  update(
    @CurrentUser() user: AuthUser,
    @Param('date', ParseDatePipe) date: string,
    @Param('photoId', ParseUUIDPipe) photoId: string,
    @Body() dto: UpdatePhotoDto,
  ): Promise<PhotoDto> {
    return this.photos.update(user.id, date, photoId, dto);
  }

  @Delete(':photoId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '사진 삭제 (F3)' })
  @ApiNoContentResponse()
  @ApiErrors({ 404: ['PHOTO_NOT_FOUND'] })
  remove(
    @CurrentUser() user: AuthUser,
    @Param('date', ParseDatePipe) date: string,
    @Param('photoId', ParseUUIDPipe) photoId: string,
  ): Promise<void> {
    return this.photos.remove(user.id, date, photoId);
  }
}
