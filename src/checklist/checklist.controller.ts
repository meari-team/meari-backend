import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  CurrentUser,
  type AuthUser,
} from '../common/decorators/current-user.decorator.js';
import { ApiErrors } from '../common/swagger/api-docs.js';
import {
  ChecklistCategoryDto,
  ChecklistCategoryListDto,
  CreateCategoryDto,
  UpdateCategoryDto,
} from './checklist.dto.js';
import { ChecklistService } from './checklist.service.js';

@ApiTags('checklist')
@ApiErrors({ 401: ['UNAUTHORIZED'] })
@Controller('checklist/categories')
export class ChecklistController {
  constructor(private readonly checklist: ChecklistService) {}

  @Get()
  @ApiOperation({ summary: '카테고리+항목 목록 (C1)' })
  @ApiOkResponse({ type: ChecklistCategoryListDto })
  async list(@CurrentUser() user: AuthUser): Promise<ChecklistCategoryListDto> {
    return { items: await this.checklist.list(user.id) };
  }

  @Post()
  @ApiOperation({ summary: '카테고리 추가 (C2) — 맨 뒤에, 최대 20개' })
  @ApiCreatedResponse({ type: ChecklistCategoryDto })
  @ApiErrors({ 400: ['VALIDATION_FAILED'] })
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateCategoryDto,
  ): Promise<ChecklistCategoryDto> {
    return this.checklist.create(user.id, dto);
  }

  @Patch(':id')
  @ApiOperation({
    summary: '카테고리 수정 (C3)',
    description:
      'items를 보내면 전체 교체: id가 있는 항목은 유지(과거 체크 보존), 빠진 항목은 삭제, id 없는 항목은 새로 추가.',
  })
  @ApiOkResponse({ type: ChecklistCategoryDto })
  @ApiErrors({ 400: ['VALIDATION_FAILED'], 404: ['CATEGORY_NOT_FOUND'] })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCategoryDto,
  ): Promise<ChecklistCategoryDto> {
    return this.checklist.update(user.id, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '카테고리 삭제 (C4) — 항목·과거 체크 기록도 함께' })
  @ApiNoContentResponse()
  @ApiErrors({ 404: ['CATEGORY_NOT_FOUND'] })
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.checklist.remove(user.id, id);
  }
}
