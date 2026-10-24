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
import { AppException } from '../common/errors/app.exception.js';
import { ApiErrors, ApiStub } from '../common/swagger/api-docs.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { toUserDto, UpdateMeDto, UserDto } from './user.dto.js';

@ApiTags('users')
@ApiErrors({ 401: ['UNAUTHORIZED'] })
@Controller('me')
export class UsersController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({ summary: '내 정보 (U1)' })
  @ApiOkResponse({ type: UserDto })
  async me(@CurrentUser() authUser: AuthUser): Promise<UserDto> {
    const user = await this.prisma.user.findUnique({
      where: { id: authUser.id },
    });
    if (!user) {
      throw new AppException(
        'UNAUTHORIZED',
        HttpStatus.UNAUTHORIZED,
        '로그인이 필요해요.',
      );
    }
    return toUserDto(user);
  }

  @Patch()
  @ApiStub('닉네임·문체 변경 (U2, P1)', 'MEA-후속')
  @ApiOkResponse({ type: UserDto })
  @ApiErrors({ 400: ['VALIDATION_FAILED'] })
  async updateMe(
    @CurrentUser() authUser: AuthUser,
    @Body() dto: UpdateMeDto,
  ): Promise<UserDto> {
    const user = await this.me(authUser);
    return { ...user, ...dto };
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiStub('회원 탈퇴 (U3) — 실제로 삭제하지 않음', 'MEA-19')
  @ApiErrors({ 503: ['AI_INDEX_UNAVAILABLE'] })
  deleteMe(): void {}
}
