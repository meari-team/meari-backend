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
import { ApiErrors, ApiStub } from '../common/swagger/api-docs.js';
import { stubCategories } from '../stubs/fixtures.js';
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
  @ApiStub('카테고리 추가 (C2, P1)', 'MEA-후속')
  @ApiCreatedResponse({ type: ChecklistCategoryDto })
  @ApiErrors({ 400: ['VALIDATION_FAILED'] })
  create(@Body() dto: CreateCategoryDto): ChecklistCategoryDto {
    return {
      ...stubCategories()[0],
      name: dto.name,
      color: dto.color,
      items: dto.items.map((label, i) => ({
        id: stubCategories()[0].items[0].id,
        label,
        sortOrder: i,
      })),
    };
  }

  @Patch(':id')
  @ApiStub('카테고리 수정 (C3, P1)', 'MEA-후속')
  @ApiOkResponse({ type: ChecklistCategoryDto })
  @ApiErrors({ 400: ['VALIDATION_FAILED'], 404: ['CATEGORY_NOT_FOUND'] })
  update(
    @Param('id', ParseUUIDPipe) _id: string,
    @Body() dto: UpdateCategoryDto,
  ): ChecklistCategoryDto {
    const base = stubCategories()[0];
    return {
      ...base,
      name: dto.name ?? base.name,
      color: dto.color ?? base.color,
    };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiStub('카테고리 삭제 (C4, P1)', 'MEA-후속')
  @ApiNoContentResponse()
  @ApiErrors({ 404: ['CATEGORY_NOT_FOUND'] })
  remove(@Param('id', ParseUUIDPipe) _id: string): void {}
}
