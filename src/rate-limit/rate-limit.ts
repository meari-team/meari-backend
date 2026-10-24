import {
  applyDecorators,
  ExecutionContext,
  HttpStatus,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ThrottlerGuard,
  type ThrottlerLimitDetail,
  type ThrottlerModuleOptions,
} from '@nestjs/throttler';
import { createHash } from 'node:crypto';
import type { Request, Response } from 'express';
import type { AuthenticatedRequest } from '../common/decorators/current-user.decorator.js';
import { AppException } from '../common/errors/app.exception.js';

// api.md §0 Rate limit
//   auth: 로그인·가입, IP당 분당 5회 (엔드포인트별)
//   ai:   분석·초안 생성 합산, 사용자당 일 20회
//   chat: 과거의 나 메시지, 사용자당 시간당 60회
//   default: 그 외 엔드포인트별 분당 120회
export type RateLimitGroup = 'auth' | 'ai' | 'chat';
const GROUP_KEY = 'rateLimitGroup';
// 그룹 안의 엔드포인트가 한도를 나눠 쓴다 (예: analyze + generate = 하루 20회)
const SHARED_GROUPS = new Set(['ai', 'chat']);

export const RateLimit = (group: RateLimitGroup) =>
  applyDecorators(SetMetadata(GROUP_KEY, group));

const groupOf = (context: ExecutionContext): string | undefined =>
  Reflect.getMetadata(GROUP_KEY, context.getHandler()) as string | undefined;

export function rateLimitOptions(
  config: ConfigService,
): ThrottlerModuleOptions {
  const num = (key: string, fallback: number) =>
    Number(config.get(key, fallback));
  const disabled = config.get('RATE_LIMIT_ENABLED', 'true') === 'false';
  const only = (group: RateLimitGroup) => (ctx: ExecutionContext) =>
    disabled || groupOf(ctx) !== group;
  return {
    setHeaders: false,
    throttlers: [
      {
        name: 'default',
        ttl: 60_000,
        limit: num('RATE_LIMIT_DEFAULT_PER_MIN', 120),
        skipIf: () => disabled,
      },
      {
        name: 'auth',
        ttl: 60_000,
        limit: num('RATE_LIMIT_AUTH_PER_MIN', 5),
        skipIf: only('auth'),
      },
      {
        name: 'ai',
        ttl: 24 * 60 * 60_000,
        limit: num('RATE_LIMIT_AI_PER_DAY', 20),
        skipIf: only('ai'),
      },
      {
        name: 'chat',
        ttl: 60 * 60_000,
        limit: num('RATE_LIMIT_CHAT_PER_HOUR', 60),
        skipIf: only('chat'),
      },
    ],
  };
}

// 로그인한 요청은 사용자 단위, 아니면 IP 단위로 센다.
// JwtAuthGuard 다음에 실행돼야 req.user가 있다 (AuthModule에서 등록 순서로 보장).
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  protected override getTracker(req: Record<string, unknown>): Promise<string> {
    const user = (req as unknown as AuthenticatedRequest).user;
    return Promise.resolve(
      user ? `user:${user.id}` : `ip:${(req as unknown as Request).ip}`,
    );
  }

  protected override generateKey(
    context: ExecutionContext,
    suffix: string,
    name: string,
  ): string {
    const scope = SHARED_GROUPS.has(name)
      ? name
      : `${context.getClass().name}-${context.getHandler().name}`;
    return createHash('sha256')
      .update(`${scope}-${name}-${suffix}`)
      .digest('hex');
  }

  protected override throwThrottlingException(
    context: ExecutionContext,
    detail: ThrottlerLimitDetail,
  ): Promise<void> {
    const retryAfter = Math.max(1, Math.ceil(detail.timeToBlockExpire));
    context
      .switchToHttp()
      .getResponse<Response>()
      .setHeader('Retry-After', String(retryAfter));
    throw new AppException(
      'TOO_MANY_REQUESTS',
      HttpStatus.TOO_MANY_REQUESTS,
      '요청이 너무 많아요. 잠시 후 다시 시도해 주세요.',
      { retryAfter },
    );
  }
}
