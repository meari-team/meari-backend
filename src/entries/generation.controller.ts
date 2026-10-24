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
import { stubEntry } from '../stubs/fixtures.js';
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
  @ApiOperation({
    summary: 'AI 일기 초안 생성 (G3)',
    description:
      'READY·GENERATED(재생성)에서 가능. QUESTIONING이면 skipRemainingQuestions: true("그냥 생성")로 남은 질문을 건너뛴다. ' +
      '초안만 만들고 확정·색인하지 않는다.',
  })
  @ApiOkResponse({ type: GenerateResultDto })
  @ApiErrors({
    409: ['INVALID_ENTRY_STATE'],
    422: ['PHOTO_REQUIRED'],
    ...AI_ERRORS,
  })
  generate(
    @CurrentUser() user: AuthUser,
    @Param('date', ParseDatePipe) date: string,
    @Body() dto: GenerateDto,
  ): Promise<GenerateResultDto> {
    return this.generation.generate(user.id, date, dto);
  }

  @Post('confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '최종본 확정 (G4)',
    description:
      'READY(직접 작성)·GENERATED·CONFIRMED(수정 후 재확정)에서 가능. 확정본만 기억이 된다: ' +
      'aiIndexStatus가 PENDING이 되고 서버가 AI 색인을 진행한다 (기억에서 제외된 일기는 NONE).',
  })
  @ApiOkResponse({ type: EntryDto })
  @ApiErrors({ 400: ['VALIDATION_FAILED'], 409: ['INVALID_ENTRY_STATE'] })
  confirm(
    @CurrentUser() user: AuthUser,
    @Param('date', ParseDatePipe) date: string,
    @Body() dto: ConfirmDto,
  ): Promise<EntryDto> {
    return this.generation.confirm(user.id, date, dto);
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
