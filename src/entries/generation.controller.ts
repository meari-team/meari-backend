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
import {
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import {
  CurrentUser,
  type AuthUser,
} from '../common/decorators/current-user.decorator.js';
import { GenerationService } from '../generation/generation.service.js';
import { ParseDatePipe } from '../common/pipes/parse-date.pipe.js';
import { ApiErrors, ApiStub } from '../common/swagger/api-docs.js';
import { STUB_DRAFT, stubEntry } from '../stubs/fixtures.js';
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
  constructor(private readonly generation: GenerationService) {}

  @Post('analyze')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '사진 분석 + 추가 질문 (G1)',
    description:
      '사진 분석 결과는 저장해 두고 재사용한다(사진이 바뀌면 다시 분석). 질문은 매번 새로 만든다(최대 2개). ' +
      '질문이 있으면 QUESTIONING, 없으면 READY. 분석·질문을 합쳐 수십 초 걸릴 수 있다.',
  })
  @ApiOkResponse({ type: AnalyzeResultDto })
  @ApiErrors({
    409: ['INVALID_ENTRY_STATE'],
    422: ['PHOTO_REQUIRED'],
    ...AI_ERRORS,
  })
  analyze(
    @CurrentUser() user: AuthUser,
    @Param('date', ParseDatePipe) date: string,
  ): Promise<AnalyzeResultDto> {
    return this.generation.analyze(user.id, date);
  }

  @Put('answers')
  @ApiOperation({
    summary: '질문 답변/건너뛰기 (G2)',
    description:
      '모든 질문이 답변되거나 건너뛰어지면 READY. answer와 skipped: true는 함께 보낼 수 없다.',
  })
  @ApiOkResponse({ type: AnalyzeResultDto })
  @ApiErrors({ 400: ['VALIDATION_FAILED'], 409: ['INVALID_ENTRY_STATE'] })
  answer(
    @CurrentUser() user: AuthUser,
    @Param('date', ParseDatePipe) date: string,
    @Body() dto: AnswersDto,
  ): Promise<AnalyzeResultDto> {
    return this.generation.answer(user.id, date, dto);
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
