import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import {
  CurrentUser,
  type AuthUser,
} from '../common/decorators/current-user.decorator.js';
import { daysBetween } from '../common/dates.js';
import { AppException } from '../common/errors/app.exception.js';
import {
  isValidDateString,
  ParseDatePipe,
} from '../common/pipes/parse-date.pipe.js';
import { ApiErrors } from '../common/swagger/api-docs.js';
import {
  EntriesRangeQueryDto,
  EntryDto,
  EntryFeedDto,
  EntryFeedQueryDto,
  EntrySummaryListDto,
  UpsertEntryDto,
} from './entries.dto.js';
import { EntriesService } from './entries.service.js';

const MAX_RANGE_DAYS = 366;

@ApiTags('entries')
@ApiErrors({ 401: ['UNAUTHORIZED'] })
@Controller('entries')
export class EntriesController {
  constructor(private readonly entries: EntriesService) {}

  @Get()
  @ApiOperation({
    summary: '캘린더용 기간 목록 (E1) — 월간·연간 공용, 최대 366일',
  })
  @ApiOkResponse({ type: EntrySummaryListDto })
  @ApiErrors({ 400: ['VALIDATION_FAILED'] })
  async list(
    @CurrentUser() user: AuthUser,
    @Query() { from, to }: EntriesRangeQueryDto,
  ): Promise<EntrySummaryListDto> {
    const days = daysBetween(from, to);
    if (!(days >= 0 && days < MAX_RANGE_DAYS)) {
      throw new AppException(
        'VALIDATION_FAILED',
        HttpStatus.BAD_REQUEST,
        `기간은 ${MAX_RANGE_DAYS}일 이내여야 해요.`,
        [{ field: 'to', reasons: ['range'] }],
      );
    }
    return { items: await this.entries.listRange(user.id, from, to) };
  }

  // ⚠️ ':date'보다 먼저 선언해야 'feed'가 날짜 파이프로 가지 않는다
  @Get('feed')
  @ApiOperation({
    summary: '전체 일기 목록 (E5) — 날짜 내림차순, before 커서',
    description:
      '상태 무관(작성 중 포함). before가 있으면 그 날짜 미만만. 다음 페이지는 nextBefore로.',
  })
  @ApiOkResponse({ type: EntryFeedDto })
  @ApiErrors({ 400: ['VALIDATION_FAILED'] })
  feed(
    @CurrentUser() user: AuthUser,
    @Query() { before, limit }: EntryFeedQueryDto,
  ): Promise<EntryFeedDto> {
    if (before !== undefined && !isValidDateString(before)) {
      throw new AppException(
        'VALIDATION_FAILED',
        HttpStatus.BAD_REQUEST,
        '날짜는 YYYY-MM-DD 형식이어야 해요.',
        [{ field: 'before', reasons: ['isDate'] }],
      );
    }
    return this.entries.feed(user.id, before, limit ?? 20);
  }

  @Get(':date')
  @ApiParam({ name: 'date', example: '2026-10-24' })
  @ApiOperation({ summary: '일기 상세 (E2)' })
  @ApiOkResponse({ type: EntryDto })
  @ApiErrors({ 404: ['ENTRY_NOT_FOUND'], 422: ['DATE_IN_FUTURE'] })
  get(
    @CurrentUser() user: AuthUser,
    @Param('date', ParseDatePipe) date: string,
  ): Promise<EntryDto> {
    return this.entries.get(user.id, date);
  }

  @Put(':date')
  @ApiParam({ name: 'date', example: '2026-10-24' })
  @ApiOperation({
    summary: '일기 생성/입력 저장 (E3) — 없으면 201, 있으면 200',
    description:
      'note: 생략하면 유지, null이면 삭제. checkedItemIds: 보내면 전체 교체.',
  })
  @ApiCreatedResponse({ type: EntryDto })
  @ApiOkResponse({ type: EntryDto })
  @ApiErrors({ 400: ['VALIDATION_FAILED'], 422: ['DATE_IN_FUTURE'] })
  async upsert(
    @CurrentUser() user: AuthUser,
    @Param('date', ParseDatePipe) date: string,
    @Body() dto: UpsertEntryDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<EntryDto> {
    const { created, entry } = await this.entries.upsert(user.id, date, dto);
    res.status(created ? HttpStatus.CREATED : HttpStatus.OK);
    return entry;
  }

  @Delete(':date')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiParam({ name: 'date', example: '2026-10-24' })
  @ApiOperation({
    summary: '일기 삭제 (E4) — AI 색인을 먼저 지우고, 실패하면 503',
  })
  @ApiNoContentResponse()
  @ApiErrors({ 404: ['ENTRY_NOT_FOUND'], 503: ['AI_INDEX_UNAVAILABLE'] })
  remove(
    @CurrentUser() user: AuthUser,
    @Param('date', ParseDatePipe) date: string,
  ): Promise<void> {
    return this.entries.remove(user.id, date);
  }
}
