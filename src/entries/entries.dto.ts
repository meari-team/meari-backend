import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AiIndexStatus, EntryStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ── 응답 ────────────────────────────────────────────────

export class PhotoDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ description: '서명 URL, 1시간 만료' })
  url: string;

  @ApiProperty({ type: Number, nullable: true })
  width: number | null;

  @ApiProperty({ type: Number, nullable: true })
  height: number | null;

  @ApiProperty({ type: String, nullable: true })
  caption: string | null;

  @ApiProperty({ minimum: 0, maximum: 2 })
  sortOrder: number;
}

export class PhotoListDto {
  @ApiProperty({ type: [PhotoDto] })
  items: PhotoDto[];
}

export class QuestionDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  question: string;

  @ApiProperty({ description: '왜 묻는지 (화면 보조 문구)' })
  reason: string;

  @ApiProperty({
    type: [String],
    nullable: true,
    description: '보기. AI-2 전엔 null → 자유 입력',
  })
  options: string[] | null;

  @ApiProperty({ type: String, nullable: true })
  answer: string | null;

  @ApiProperty()
  skipped: boolean;
}

export class EntrySummaryDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'date', example: '2026-10-24' })
  date: string;

  @ApiProperty({ enum: EntryStatus, enumName: 'EntryStatus' })
  status: EntryStatus;

  @ApiProperty({ type: String, nullable: true })
  coverPhotoUrl: string | null;

  @ApiProperty({ type: String, nullable: true, description: 'P1 하루 요약' })
  summary: string | null;

  @ApiProperty({ type: [String], description: '그날 체크된 카테고리 색' })
  categoryColors: string[];
}

export class EntrySummaryListDto {
  @ApiProperty({ type: [EntrySummaryDto] })
  items: EntrySummaryDto[];
}

export class EntryFeedItemDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'date', example: '2026-10-24' })
  date: string;

  @ApiProperty({ enum: EntryStatus, enumName: 'EntryStatus' })
  status: EntryStatus;

  @ApiProperty({
    type: String,
    nullable: true,
    description: '대표 사진, 없으면 첫 사진 (서명 URL)',
  })
  coverPhotoUrl: string | null;

  @ApiProperty()
  photoCount: number;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      '확정본 → AI 초안 → 한 줄 설명 중 처음 비어 있지 않은 것. 공백 정리, 120자 초과 시 120자 + …',
  })
  excerpt: string | null;

  @ApiProperty({ type: [String], description: '그날 체크된 카테고리 색' })
  categoryColors: string[];

  @ApiProperty({ enum: AiIndexStatus, enumName: 'AiIndexStatus' })
  aiIndexStatus: AiIndexStatus;
}

export class EntryFeedDto {
  @ApiProperty({ type: [EntryFeedItemDto], description: '날짜 내림차순' })
  items: EntryFeedItemDto[];

  @ApiProperty({
    type: String,
    format: 'date',
    nullable: true,
    description: '다음 페이지는 before=이 값으로. 없으면 null',
  })
  nextBefore: string | null;
}

export class EntryDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'date', example: '2026-10-24' })
  date: string;

  @ApiProperty({ enum: EntryStatus, enumName: 'EntryStatus' })
  status: EntryStatus;

  @ApiProperty({ type: String, nullable: true })
  note: string | null;

  @ApiProperty({ type: [PhotoDto] })
  photos: PhotoDto[];

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  coverPhotoId: string | null;

  @ApiProperty({ type: [String] })
  checkedItemIds: string[];

  @ApiProperty({ type: [QuestionDto] })
  questions: QuestionDto[];

  @ApiProperty({ type: String, nullable: true })
  aiDraft: string | null;

  @ApiProperty({
    type: [String],
    description: '하이라이트할 추정 문장. AI-3 전엔 []',
  })
  aiUncertain: string[];

  @ApiProperty({ type: String, nullable: true })
  finalContent: string | null;

  @ApiProperty({ type: String, nullable: true })
  summary: string | null;

  @ApiProperty()
  excludedFromMemory: boolean;

  @ApiProperty({ enum: AiIndexStatus, enumName: 'AiIndexStatus' })
  aiIndexStatus: AiIndexStatus;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  confirmedAt: string | null;

  @ApiProperty({ format: 'date-time' })
  updatedAt: string;
}

export class AnalyzeResultDto {
  @ApiProperty({ enum: EntryStatus, enumName: 'EntryStatus' })
  status: EntryStatus;

  @ApiProperty({ type: [QuestionDto], maxItems: 2 })
  questions: QuestionDto[];
}

export class GenerateResultDto {
  @ApiProperty({ enum: EntryStatus, enumName: 'EntryStatus' })
  status: EntryStatus;

  @ApiProperty()
  aiDraft: string;

  @ApiProperty({ type: [String] })
  aiUncertain: string[];

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  coverPhotoId: string | null;
}

// ── 요청 ────────────────────────────────────────────────

export class EntriesRangeQueryDto {
  @ApiProperty({ format: 'date', example: '2026-10-01' })
  @Matches(DATE_RE)
  from: string;

  @ApiProperty({
    format: 'date',
    example: '2026-10-31',
    description: 'from부터 최대 366일',
  })
  @Matches(DATE_RE)
  to: string;
}

export class EntryFeedQueryDto {
  @ApiPropertyOptional({
    format: 'date',
    example: '2026-10-24',
    description: '이 날짜 미만(제외)만. 이전 응답의 nextBefore',
  })
  @IsOptional()
  @Matches(DATE_RE)
  before?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 50, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

export class UpsertEntryDto {
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 200 })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(200)
  note?: string | null;

  @ApiPropertyOptional({
    type: [String],
    description: '본인 체크리스트 항목 ID',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsUUID('4', { each: true })
  checkedItemIds?: string[];
}

// multipart 본문 중 텍스트 필드. 파일(files)은 multer가 받아 @UploadedFiles()로 들어온다.
export class UploadPhotosDto {
  @ApiPropertyOptional({
    description: 'files와 같은 순서의 캡션 배열(JSON 문자열), 각 100자 이하',
    example: '["카페에서", ""]',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  captions?: string;
}

// Swagger 문서용 multipart 스키마
export const uploadPhotosBodySchema = {
  type: 'object',
  required: ['files'],
  properties: {
    files: {
      type: 'array',
      items: { type: 'string', format: 'binary' },
      maxItems: 3,
      description: 'jpeg/png/webp, 장당 4MB',
    },
    captions: {
      type: 'string',
      description: 'files와 같은 순서의 캡션 배열(JSON 문자열), 각 100자 이하',
      example: '["카페에서", ""]',
    },
  },
};

export class UpdatePhotoDto {
  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  caption?: string;

  @ApiPropertyOptional({ minimum: 0, maximum: 2 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(2)
  sortOrder?: number;
}

export class AnswerInputDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  questionId: string;

  @ApiPropertyOptional({ minLength: 1, maxLength: 2000 })
  @ValidateIf((o: AnswerInputDto) => !o.skipped)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(1, 2000)
  answer?: string;

  @ApiPropertyOptional({ description: 'true면 건너뛰기 (answer와 동시 불가)' })
  @IsOptional()
  @IsBoolean()
  skipped?: boolean;
}

export class AnswersDto {
  @ApiProperty({ type: [AnswerInputDto], maxItems: 2 })
  @IsArray()
  @ArrayMaxSize(2)
  @ValidateNested({ each: true })
  @Type(() => AnswerInputDto)
  answers: AnswerInputDto[];
}

export class GenerateDto {
  @ApiPropertyOptional({ description: '"그냥 생성" — 남은 질문을 건너뛴다' })
  @IsOptional()
  @IsBoolean()
  skipRemainingQuestions?: boolean;
}

export class ConfirmDto {
  @ApiProperty({ minLength: 1, maxLength: 10000 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(1, 10000)
  finalContent: string;
}

export class UpdateMemoryDto {
  @ApiProperty({ description: 'true면 기억에서 제외' })
  @IsBoolean()
  excluded: boolean;
}
