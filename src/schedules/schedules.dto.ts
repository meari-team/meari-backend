import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsOptional,
  IsString,
  Length,
  Matches,
  ValidateIf,
} from 'class-validator';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class ScheduleDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'date', example: '2026-10-24' })
  date: string;

  @ApiProperty({ maxLength: 50 })
  title: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '14:00',
    description: 'HH:mm, 없으면 종일',
  })
  time: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt: string;
}

export class ScheduleListDto {
  @ApiProperty({
    type: [ScheduleDto],
    description: '날짜 → 시간(종일이 먼저) → 등록순',
  })
  items: ScheduleDto[];
}

export class SchedulesRangeQueryDto {
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

export class CreateScheduleDto {
  @ApiProperty({
    format: 'date',
    example: '2026-10-24',
    description: '미래 날짜 허용',
  })
  @Matches(DATE_RE)
  date: string;

  @ApiProperty({ minLength: 1, maxLength: 50 })
  @Transform(trim)
  @IsString()
  @Length(1, 50)
  title: string;

  @ApiPropertyOptional({ type: String, nullable: true, example: '14:00' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Matches(TIME_RE)
  time?: string | null;
}

export class UpdateScheduleDto {
  @ApiPropertyOptional({ format: 'date', example: '2026-10-25' })
  @IsOptional()
  @Matches(DATE_RE)
  date?: string;

  @ApiPropertyOptional({ minLength: 1, maxLength: 50 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 50)
  title?: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: '14:00',
    description: 'null이면 시간을 지운다(종일)',
  })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Matches(TIME_RE)
  time?: string | null;
}
