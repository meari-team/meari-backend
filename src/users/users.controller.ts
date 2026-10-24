import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  CurrentUser,
  type AuthUser,
} from '../common/decorators/current-user.decorator.js';
import { ApiErrors } from '../common/swagger/api-docs.js';
import { UsersService } from './users.service.js';
import { UpdateMeDto, UserDto } from './user.dto.js';

@ApiTags('users')
@ApiErrors({ 401: ['UNAUTHORIZED'] })
@Controller('me')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @ApiOperation({ summary: '내 정보 (U1)' })
  @ApiOkResponse({ type: UserDto })
  me(@CurrentUser() authUser: AuthUser): Promise<UserDto> {
    return this.users.me(authUser.id);
  }

  @Patch()
  @ApiOperation({ summary: '닉네임·문체 변경 (U2) — 보낸 필드만 바꾼다' })
  @ApiOkResponse({ type: UserDto })
  @ApiErrors({ 400: ['VALIDATION_FAILED'] })
  updateMe(
    @CurrentUser() authUser: AuthUser,
    @Body() dto: UpdateMeDto,
  ): Promise<UserDto> {
    return this.users.update(authUser.id, dto);
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: '회원 탈퇴 (U3)',
    description:
      'AI 기억을 먼저 모두 지우고, 하나라도 실패하면 503이며 아무것도 지우지 않는다. ' +
      '성공하면 일기·사진·체크리스트·채팅을 모두 삭제한다. 이후 기존 토큰은 401.',
  })
  @ApiErrors({ 503: ['AI_INDEX_UNAVAILABLE'] })
  withdraw(@CurrentUser() authUser: AuthUser): Promise<void> {
    return this.users.withdraw(authUser.id);
  }
}
