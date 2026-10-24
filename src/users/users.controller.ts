import { Controller, Get, HttpStatus } from '@nestjs/common';
import { AppException } from '../common/errors/app.exception.js';
import {
  CurrentUser,
  type AuthUser,
} from '../common/decorators/current-user.decorator.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { toUserDto, type UserDto } from './user.dto.js';

@Controller('me')
export class UsersController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
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
}
