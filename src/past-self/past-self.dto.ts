import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ChatFlag, ChatRole } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const PRESETS = ['1W', '1M', '3M', '6M', '1Y'] as const;
export type Preset = (typeof PRESETS)[number];

// ── 응답 ────────────────────────────────────────────────

export class AvailabilityDto {
  @ApiProperty({ format: 'date' })
  anchorDate: string;

  @ApiProperty()
  available: boolean;

  @ApiProperty({ description: 'T 이전 확정·미제외 일기 수' })
  recordCount: number;

  @ApiProperty({ type: String, format: 'date', nullable: true })
  firstRecordDate: string | null;

  @ApiProperty({ example: 7 })
  requiredCount: number;
}

export class AvailabilityPresetDto {
  @ApiProperty({ enum: PRESETS, enumName: 'Preset' })
  preset: Preset;

  @ApiProperty({ format: 'date' })
  anchorDate: string;

  @ApiProperty()
  available: boolean;

  @ApiProperty()
  recordCount: number;
}

export class AvailabilityPresetListDto {
  @ApiProperty({ type: [AvailabilityPresetDto] })
  items: AvailabilityPresetDto[];
}

export class ChatSessionDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'date', description: '기준 시점 T' })
  anchorDate: string;

  @ApiProperty()
  messageCount: number;

  @ApiProperty({ format: 'date-time' })
  createdAt: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  lastMessageAt: string | null;

  @ApiProperty({ type: String, nullable: true })
  lastMessagePreview: string | null;
}

export class ChatSessionListDto {
  @ApiProperty({ type: [ChatSessionDto] })
  items: ChatSessionDto[];
}

export class CitationDto {
  @ApiProperty({ format: 'uuid' })
  entryId: string;

  @ApiProperty({ format: 'date' })
  date: string;
}

export class ChatMessageDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ enum: ChatRole, enumName: 'ChatRole' })
  role: ChatRole;

  @ApiProperty()
  content: string;

  @ApiProperty({
    type: [CitationDto],
    description: 'ASSISTANT만. 서버 재검증 통과분',
  })
  citations: CitationDto[];

  @ApiProperty({ enum: ChatFlag, enumName: 'ChatFlag' })
  flag: ChatFlag;

  @ApiProperty({ format: 'date-time' })
  createdAt: string;
}

export class ChatMessagePageDto {
  @ApiProperty({
    type: [ChatMessageDto],
    description: '오래된 순. cursor 없으면 가장 최근 limit개',
  })
  items: ChatMessageDto[];

  @ApiProperty({
    type: String,
    nullable: true,
    description: '더 이전 메시지를 받으려면 이 값을 cursor로 (없으면 null)',
  })
  nextCursor: string | null;
}

export class SendMessageResultDto {
  @ApiProperty({ type: ChatMessageDto })
  userMessage: ChatMessageDto;

  @ApiProperty({ type: ChatMessageDto })
  assistantMessage: ChatMessageDto;
}

// ── 요청 ────────────────────────────────────────────────

export class AvailabilityQueryDto {
  @ApiPropertyOptional({ format: 'date', description: '생략하면 프리셋 전체' })
  @IsOptional()
  @Matches(DATE_RE)
  anchorDate?: string;
}

export class CreateSessionDto {
  @ApiProperty({ format: 'date', example: '2026-09-24' })
  @Matches(DATE_RE)
  anchorDate: string;
}

export class MessagesQueryDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description: '이 메시지보다 이전 메시지를 받는다 (이전 응답의 nextCursor)',
  })
  @IsOptional()
  @IsUUID()
  cursor?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 50, default: 30 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

export class SendMessageDto {
  @ApiProperty({ minLength: 1, maxLength: 500 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(1, 500)
  content: string;
}
