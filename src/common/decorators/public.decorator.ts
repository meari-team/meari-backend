import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

// 전역 JwtAuthGuard를 건너뛴다. 인증이 필요 없는 엔드포인트에만 붙인다.
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
