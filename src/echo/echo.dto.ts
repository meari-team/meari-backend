import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { EchoFrequency, EchoMessageSource } from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { PhotoDto } from '../entries/entries.dto.js';
import { CitationDto } from '../past-self/past-self.dto.js';

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

// ── 북마크 ──────────────────────────────────────────────

export class BookmarkDto {
  @ApiProperty({ description: '기억하고 싶은 날로 표시' })
  @IsBoolean()
  bookmarked: boolean;
}

// ── 메아리 설정 ─────────────────────────────────────────

export class EchoSettingsDto {
  @ApiProperty({
    description: '메아리 알림 받기 (앱 안 수신 동의). 기본 false',
  })
  enabled: boolean;

  @ApiProperty({ enum: EchoFrequency, enumName: 'EchoFrequency' })
  frequency: EchoFrequency;

  @ApiProperty({ minimum: 0, maximum: 6, description: '주 1회: 0=일 … 6=토' })
  weekday: number;

  @ApiProperty({
    minimum: 1,
    maximum: 31,
    description: '월 1회: 그달에 없는 날짜면 마지막 날',
  })
  monthDay: number;

  @ApiProperty({ example: '21:00', description: 'HH:mm (사용자 시간대)' })
  time: string;

  @ApiProperty({ example: 'Asia/Seoul' })
  timezone: string;

  @ApiProperty({ description: '알림에 메시지 내용 미리보기 (기본 false)' })
  showPreview: boolean;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description: '다음 수신 예정. 미동의면 null',
  })
  nextRunAt: string | null;

  @ApiProperty({ description: '메아리 후보 = 북마크한 확정·기억 포함 일기 수' })
  candidateCount: number;

  @ApiProperty({ description: '이 기기·계정에 등록된 푸시 토큰이 있는지' })
  pushRegistered: boolean;

  @ApiProperty({ description: '시연용 즉시 받기를 쓸 수 있는지 (ECHO_DEMO)' })
  demoAvailable: boolean;
}

export class UpdateEchoSettingsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({ enum: EchoFrequency, enumName: 'EchoFrequency' })
  @IsOptional()
  @IsEnum(EchoFrequency)
  frequency?: EchoFrequency;

  @ApiPropertyOptional({ minimum: 0, maximum: 6 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(6)
  weekday?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 31 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(31)
  monthDay?: number;

  @ApiPropertyOptional({ example: '21:00' })
  @IsOptional()
  @Matches(TIME_RE)
  time?: string;

  @ApiPropertyOptional({ example: 'Asia/Seoul', description: 'IANA 시간대' })
  @IsOptional()
  @IsString()
  @Length(1, 64)
  timezone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  showPreview?: boolean;
}

// ── 푸시 토큰 ───────────────────────────────────────────

export class PushTokenDto {
  @ApiProperty({ example: 'ExponentPushToken[xxxxxxxx]' })
  @IsString()
  @Matches(/^Expo(nent)?PushToken\[.+\]$/)
  @Length(1, 255)
  token: string;

  @ApiProperty({ enum: ['ios', 'android'] })
  @IsIn(['ios', 'android'])
  platform: 'ios' | 'android';
}

export class RemovePushTokenDto {
  @ApiProperty()
  @IsString()
  @Length(1, 255)
  token: string;
}

// ── 메아리 ──────────────────────────────────────────────

export class EchoChatDto {
  @ApiProperty({ description: '이 기준일로 과거의 나와 대화할 수 있는지' })
  available: boolean;

  @ApiProperty()
  recordCount: number;

  @ApiProperty({ example: 7 })
  requiredCount: number;
}

export class EchoSummaryDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({
    format: 'date',
    description: '메아리를 보낸 날 (= 대화 기준일)',
  })
  entryDate: string;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  sessionId: string | null;

  @ApiProperty({ description: '첫 메시지 미리보기' })
  preview: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  readAt: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt: string;
}

export class EchoListDto {
  @ApiProperty({
    type: [EchoSummaryDto],
    description: '최근 것부터, 최대 50개',
  })
  items: EchoSummaryDto[];

  @ApiProperty()
  unreadCount: number;
}

export class EchoDto extends EchoSummaryDto {
  @ApiProperty({ description: '과거의 나가 먼저 보낸 메시지' })
  message: string;

  @ApiProperty({ enum: EchoMessageSource, enumName: 'EchoMessageSource' })
  source: EchoMessageSource;

  @ApiProperty({ type: [CitationDto], description: '메시지 근거 일기' })
  citations: CitationDto[];

  @ApiProperty({ type: [PhotoDto], description: '그날 사진 (저장된 원본)' })
  photos: PhotoDto[];

  @ApiProperty({ type: String, nullable: true, description: '그날 확정 일기' })
  finalContent: string | null;

  @ApiProperty({ description: '메시지를 만든 뒤 일기가 수정됐는지' })
  entryEdited: boolean;

  @ApiProperty({ type: EchoChatDto })
  chat: EchoChatDto;
}
