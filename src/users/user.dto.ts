import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DiaryStyle, type User } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';
import { PASSWORD_PATTERN } from '../auth/password-policy.js';

export class UserDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'email' })
  email: string;

  @ApiProperty()
  nickname: string;

  @ApiProperty({ enum: DiaryStyle, enumName: 'DiaryStyle' })
  diaryStyle: DiaryStyle;

  @ApiProperty({ format: 'date-time' })
  createdAt: string;
}

// 응답에 나가는 필드를 명시적으로 고른다. passwordHash는 절대 포함하지 않는다.
export function toUserDto(user: User): UserDto {
  return {
    id: user.id,
    email: user.email,
    nickname: user.nickname,
    diaryStyle: user.diaryStyle,
    createdAt: user.createdAt.toISOString(),
  };
}

export class UpdateMeDto {
  @ApiPropertyOptional({ minLength: 1, maxLength: 20 })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(1, 20)
  nickname?: string;

  @ApiPropertyOptional({ enum: DiaryStyle, enumName: 'DiaryStyle' })
  @IsOptional()
  @IsEnum(DiaryStyle)
  diaryStyle?: DiaryStyle;
}

export class ChangePasswordDto {
  // 지금 비밀번호는 규칙을 검사하지 않는다 (규칙이 생기기 전·시연용 계정도 바꿀 수 있게)
  @ApiProperty({ maxLength: 64 })
  @IsString()
  @MaxLength(64)
  currentPassword: string;

  @ApiProperty({
    minLength: 8,
    maxLength: 64,
    description: '회원가입과 같은 규칙: 영문과 숫자를 각각 1자 이상',
  })
  @IsString()
  @Matches(PASSWORD_PATTERN)
  newPassword: string;
}
