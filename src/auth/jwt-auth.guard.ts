import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator.js';
import type { AuthenticatedRequest } from '../common/decorators/current-user.decorator.js';
import { AppException } from '../common/errors/app.exception.js';
import { PrismaService } from '../prisma/prisma.service.js';

const unauthorized = () =>
  new AppException(
    'UNAUTHORIZED',
    HttpStatus.UNAUTHORIZED,
    '로그인이 필요해요.',
  );

// 전역 가드. @Public()이 없는 모든 엔드포인트는 유효한 토큰과 존재하는 사용자가 필요하다.
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const [scheme, token] = req.headers.authorization?.split(' ') ?? [];
    if (scheme !== 'Bearer' || !token) throw unauthorized();

    let sub: unknown;
    try {
      ({ sub } = await this.jwt.verifyAsync<{ sub: unknown }>(token));
    } catch {
      throw unauthorized();
    }
    if (typeof sub !== 'string') throw unauthorized();

    // 탈퇴한 사용자의 토큰은 만료 전이어도 거부한다 (리프레시 토큰이 없으므로).
    const user = await this.prisma.user.findUnique({
      where: { id: sub },
      select: { id: true },
    });
    if (!user) throw unauthorized();

    req.user = { id: user.id };
    return true;
  }
}
