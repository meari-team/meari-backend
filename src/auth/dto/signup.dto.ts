import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsString, Length, Matches, MaxLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class SignupDto {
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @ApiProperty({ format: 'email', maxLength: 255 })
  @IsEmail()
  @MaxLength(255)
  email: string;

  // 8~64자, 영문과 숫자를 각각 1자 이상
  @ApiProperty({
    minLength: 8,
    maxLength: 64,
    description: '영문과 숫자를 각각 1자 이상',
  })
  @IsString()
  @Matches(/^(?=.*[A-Za-z])(?=.*\d).{8,64}$/)
  password: string;

  @ApiProperty({ minLength: 1, maxLength: 20 })
  @Transform(trim)
  @IsString()
  @Length(1, 20)
  nickname: string;
}
