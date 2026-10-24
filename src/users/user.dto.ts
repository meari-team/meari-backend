import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DiaryStyle, type User } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsString, Length } from 'class-validator';

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
