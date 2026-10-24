import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

export type AuthUser = { id: string };

export type AuthenticatedRequest = Request & { user: AuthUser };

// JwtAuthGuard가 토큰에서 꺼낸 사용자. userId는 항상 여기서만 가져온다.
export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthUser =>
    ctx.switchToHttp().getRequest<AuthenticatedRequest>().user,
);
