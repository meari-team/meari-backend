import { ApiProperty } from '@nestjs/swagger';
import { UserDto } from '../../users/user.dto.js';

export class AuthResultDto {
  @ApiProperty({ description: 'Bearer 토큰 (7일)' })
  accessToken: string;

  @ApiProperty({ type: UserDto })
  user: UserDto;
}
