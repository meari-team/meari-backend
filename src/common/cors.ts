import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface.js';

// 개발 중 Expo 웹(localhost:8081 등)에서 API를 부를 수 있게 한다.
// 로그인은 쿠키가 아니라 Authorization 헤더라서, 다른 사이트가 사용자 자격으로 요청을 보낼 수는 없다.
const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

// CORS_ORIGINS: 쉼표로 구분한 허용 주소. 비어 있으면
// 개발 환경은 localhost·127.0.0.1(포트 무관), 운영 환경은 CORS를 열지 않는다.
export function corsOptions(env: {
  NODE_ENV?: string;
  CORS_ORIGINS?: string;
}): CorsOptions | null {
  const listed = (env.CORS_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim().replace(/\/+$/, ''))
    .filter(Boolean);

  let origin: CorsOptions['origin'];
  if (listed.length > 0) origin = listed;
  else if (env.NODE_ENV === 'production') return null;
  else origin = LOCAL_ORIGIN;

  return {
    origin,
    credentials: false,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Authorization', 'Content-Type'],
    exposedHeaders: ['Retry-After'],
    maxAge: 600,
  };
}
