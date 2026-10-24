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
} from '@nestjs/common';
import {
  ApiNoContentResponse,
  ApiOkResponse,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { AppException } from '../common/errors/app.exception.js';
import { ParseDatePipe } from '../common/pipes/parse-date.pipe.js';
import { ApiErrors, ApiStub } from '../common/swagger/api-docs.js';
import { stubEntry, stubEntrySummaries } from '../stubs/fixtures.js';
import {
  EntriesRangeQueryDto,
  EntryDto,
  EntrySummaryListDto,
  UpsertEntryDto,
} from './entries.dto.js';

const MAX_RANGE_DAYS = 366;
const DAY_MS = 24 * 60 * 60 * 1000;

@ApiTags('entries')
@ApiErrors({ 401: ['UNAUTHORIZED'] })
@Controller('entries')
export class EntriesController {
  @Get()
  @ApiStub('캘린더용 기간 목록 (E1)', 'MEA-7')
  @ApiOkResponse({ type: EntrySummaryListDto })
  @ApiErrors({ 400: ['VALIDATION_FAILED'] })
  list(@Query() { from, to }: EntriesRangeQueryDto): EntrySummaryListDto {
    const days =
      (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
      DAY_MS;
    if (!(days >= 0 && days < MAX_RANGE_DAYS)) {
      throw new AppException(
        'VALIDATION_FAILED',
        HttpStatus.BAD_REQUEST,
        `기간은 ${MAX_RANGE_DAYS}일 이내여야 해요.`,
        [{ field: 'to', reasons: ['range'] }],
      );
    }
    return { items: stubEntrySummaries(from, to) };
  }

  @Get(':date')
  @ApiParam({ name: 'date', example: '2026-10-24' })
  @ApiStub('일기 상세 (E2)', 'MEA-7')
  @ApiOkResponse({ type: EntryDto })
  @ApiErrors({ 404: ['ENTRY_NOT_FOUND'], 422: ['DATE_IN_FUTURE'] })
  get(@Param('date', ParseDatePipe) date: string): EntryDto {
    return stubEntry(date);
  }

  @Put(':date')
  @ApiParam({ name: 'date', example: '2026-10-24' })
  @ApiStub('일기 생성/입력 저장 (E3) — 없으면 201, 있으면 200', 'MEA-7')
  @ApiOkResponse({ type: EntryDto })
  @ApiErrors({ 400: ['VALIDATION_FAILED'], 422: ['DATE_IN_FUTURE'] })
  upsert(
    @Param('date', ParseDatePipe) date: string,
    @Body() dto: UpsertEntryDto,
  ): EntryDto {
    const entry = stubEntry(date);
    return {
      ...entry,
      status: 'DRAFT',
      note: dto.note ?? entry.note,
      checkedItemIds: dto.checkedItemIds ?? entry.checkedItemIds,
      questions: [],
      aiDraft: null,
      aiUncertain: [],
    };
  }

  @Delete(':date')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiParam({ name: 'date', example: '2026-10-24' })
  @ApiStub('일기 삭제 (E4) — 사진·AI 색인 포함', 'MEA-7')
  @ApiNoContentResponse()
  @ApiErrors({ 404: ['ENTRY_NOT_FOUND'], 503: ['AI_INDEX_UNAVAILABLE'] })
  remove(@Param('date', ParseDatePipe) _date: string): void {}
}
