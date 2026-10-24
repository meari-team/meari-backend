import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { ApiOkResponse, ApiParam, ApiTags } from '@nestjs/swagger';
import { ParseDatePipe } from '../common/pipes/parse-date.pipe.js';
import { ApiErrors, ApiStub } from '../common/swagger/api-docs.js';
import { STUB_DRAFT, stubEntry, stubQuestions } from '../stubs/fixtures.js';
import {
  AnalyzeResultDto,
  AnswersDto,
  ConfirmDto,
  EntryDto,
  GenerateDto,
  GenerateResultDto,
  UpdateMemoryDto,
} from './entries.dto.js';

const AI_ERRORS = {
  502: ['AI_UPSTREAM_ERROR' as const],
  504: ['AI_TIMEOUT' as const],
};

@ApiTags('generation')
@ApiParam({ name: 'date', example: '2026-10-24' })
@ApiErrors({ 401: ['UNAUTHORIZED'], 404: ['ENTRY_NOT_FOUND'] })
@Controller('entries/:date')
export class GenerationController {
  @Post('analyze')
  @HttpCode(HttpStatus.OK)
  @ApiStub('사진 분석 + 추가 질문 (G1)', 'MEA-10')
  @ApiOkResponse({ type: AnalyzeResultDto })
  @ApiErrors({
    409: ['INVALID_ENTRY_STATE'],
    422: ['PHOTO_REQUIRED'],
    ...AI_ERRORS,
  })
  analyze(@Param('date', ParseDatePipe) _date: string): AnalyzeResultDto {
    return { status: 'QUESTIONING', questions: stubQuestions() };
  }

  @Put('answers')
  @ApiStub('질문 답변/건너뛰기 (G2)', 'MEA-10')
  @ApiOkResponse({ type: AnalyzeResultDto })
  @ApiErrors({ 400: ['VALIDATION_FAILED'], 409: ['INVALID_ENTRY_STATE'] })
  answer(
    @Param('date', ParseDatePipe) _date: string,
    @Body() dto: AnswersDto,
  ): AnalyzeResultDto {
    const questions = stubQuestions().map((q) => {
      const a = dto.answers.find((x) => x.questionId === q.id);
      return a
        ? {
            ...q,
            answer: a.skipped ? null : (a.answer ?? null),
            skipped: !!a.skipped,
          }
        : q;
    });
    const done = questions.every((q) => q.answer !== null || q.skipped);
    return { status: done ? 'READY' : 'QUESTIONING', questions };
  }

  @Post('generate')
  @HttpCode(HttpStatus.OK)
  @ApiStub('AI 일기 초안 생성 (G3)', 'MEA-11')
  @ApiOkResponse({ type: GenerateResultDto })
  @ApiErrors({
    409: ['INVALID_ENTRY_STATE'],
    422: ['PHOTO_REQUIRED'],
    ...AI_ERRORS,
  })
  generate(
    @Param('date', ParseDatePipe) date: string,
    @Body() _dto: GenerateDto,
  ): GenerateResultDto {
    const entry = stubEntry(date);
    return {
      status: 'GENERATED',
      aiDraft: STUB_DRAFT,
      aiUncertain: entry.aiUncertain,
      coverPhotoId: entry.coverPhotoId,
    };
  }

  @Post('confirm')
  @HttpCode(HttpStatus.OK)
  @ApiStub('최종본 확정 → AI 색인 (G4)', 'MEA-11')
  @ApiOkResponse({ type: EntryDto })
  @ApiErrors({ 400: ['VALIDATION_FAILED'], 409: ['INVALID_ENTRY_STATE'] })
  confirm(
    @Param('date', ParseDatePipe) date: string,
    @Body() dto: ConfirmDto,
  ): EntryDto {
    return {
      ...stubEntry(date),
      status: 'CONFIRMED',
      finalContent: dto.finalContent,
      aiIndexStatus: 'PENDING',
      confirmedAt: new Date().toISOString(),
    };
  }

  @Patch('memory')
  @ApiStub('기억에서 제외/복원 (G5, P1)', 'MEA-23')
  @ApiOkResponse({ type: EntryDto })
  @ApiErrors({ 503: ['AI_INDEX_UNAVAILABLE'] })
  updateMemory(
    @Param('date', ParseDatePipe) date: string,
    @Body() dto: UpdateMemoryDto,
  ): EntryDto {
    return {
      ...stubEntry(date),
      status: 'CONFIRMED',
      excludedFromMemory: dto.excluded,
      aiIndexStatus: dto.excluded ? 'NONE' : 'PENDING',
    };
  }
}
