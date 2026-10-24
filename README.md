# meari-backend

메아리 API 서버 — NestJS 12 · Prisma · PostgreSQL

인증, 일기 원본 저장, 사진, 체크리스트, 채팅 세션을 담당하고 AI 서버(`meari-ai`)를 호출한다.
설계 문서는 [meari-docs](https://github.com/meari-team/meari-docs) (PRD · ERD · API · ADR · 개발 플로우).

## 시작하기

```bash
npm ci                 # postinstall에서 prisma generate 실행
cp .env.example .env   # 값 채우기
docker compose up -d   # 로컬 DB (또는 Supabase URL 사용)
npm run db:deploy      # 마이그레이션 적용
npm run start:dev      # http://localhost:3000
```

## DB (Prisma 6.19.3)

- 스키마: `prisma/schema.prisma` — 설계 근거는 meari-docs `erd.md`
- 스키마를 바꾸면 `npm run db:migrate -- --name <변경내용>`으로 마이그레이션을 만들고 같은 PR에 커밋한다.
- Prisma 스키마로 표현할 수 없는 부분 인덱스는 마이그레이션 SQL에 직접 추가돼 있다 (`20261024035736_init`).
- Supabase: `DATABASE_URL`은 pooler(6543, `?pgbouncer=true&connection_limit=1`), `DIRECT_URL`은 직접 연결(5432). 마이그레이션은 `DIRECT_URL`로 실행된다.
- e2e 테스트(`npm run test:e2e`)는 마이그레이션이 적용된 DB가 필요하다.

## 스크립트

| 명령 | 내용 |
|---|---|
| `npm run start:dev` | 개발 서버 (watch) |
| `npm run lint` | oxlint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | 유닛 테스트 (Vitest) |
| `npm run test:e2e` | e2e 테스트 (Vitest + supertest) |
| `npm run build` | 빌드 |
| `npm run db:migrate` | 마이그레이션 생성·적용 (개발) |
| `npm run db:deploy` | 마이그레이션 적용 (CI·배포) |
| `npm run db:studio` | Prisma Studio |

## 브랜치

`develop`(기본) ← `feat/MEA-N-*` PR (squash) · `main` ← `develop` 릴리스 PR (merge commit). 자세한 규칙은 meari-docs의 `dev-flow.md` §4.
