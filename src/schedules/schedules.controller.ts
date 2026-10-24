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
  Query,
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
  CreateScheduleDto,
  ScheduleDto,
  ScheduleListDto,
  SchedulesRangeQueryDto,
  UpdateScheduleDto,
} from './schedules.dto.js';
import { SchedulesService } from './schedules.service.js';

@ApiTags('schedules')
@ApiErrors({ 401: ['UNAUTHORIZED'] })
@Controller('schedules')
export class SchedulesController {
  constructor(private readonly schedules: SchedulesService) {}

  @Get()
  @ApiOperation({
    summary:
      '기간 일정 목록 (S2) — 최대 366일, 날짜 → 시간(종일 먼저) → 등록순',
  })
  @ApiOkResponse({ type: ScheduleListDto })
  @ApiErrors({ 400: ['VALIDATION_FAILED'] })
  async list(
    @CurrentUser() user: AuthUser,
    @Query() { from, to }: SchedulesRangeQueryDto,
  ): Promise<ScheduleListDto> {
    return { items: await this.schedules.list(user.id, from, to) };
  }

  @Post()
  @ApiOperation({
    summary: '일정 추가 (S3) — 미래 날짜 허용, 하루 20개까지',
    description: '그날 일기를 만들 때 일정이 AI 설명에 함께 들어간다.',
  })
  @ApiCreatedResponse({ type: ScheduleDto })
  @ApiErrors({ 400: ['VALIDATION_FAILED'], 422: ['SCHEDULE_LIMIT_EXCEEDED'] })
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateScheduleDto,
  ): Promise<ScheduleDto> {
    return this.schedules.create(user.id, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: '일정 수정 (S4) — time: null이면 종일로, completed로 완료 체크' })
  @ApiOkResponse({ type: ScheduleDto })
  @ApiErrors({
    400: ['VALIDATION_FAILED'],
    404: ['SCHEDULE_NOT_FOUND'],
    422: ['SCHEDULE_LIMIT_EXCEEDED'],
  })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateScheduleDto,
  ): Promise<ScheduleDto> {
    return this.schedules.update(user.id, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '일정 삭제 (S5)' })
  @ApiNoContentResponse()
  @ApiErrors({ 404: ['SCHEDULE_NOT_FOUND'] })
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.schedules.remove(user.id, id);
  }
}
