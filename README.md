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
npm run build && npm run seed:demo   # 시연 계정 만들기 (선택, 아래 참고)
npm run start:dev      # http://localhost:3000
```

### 시연 계정 (`npm run seed:demo`)

로그인 `test@test.com` / `test`. 가상 사용자(컴공 3학년)의 일기 90편(2026-04-01 ~ 10-25, 체크리스트 포함)과 일정 7개가 들어 있어 바로 캘린더·과거의 나(1주·1개월·3개월·6개월 전)를 써 볼 수 있다. 데이터는 `src/scripts/demo-data.ts`.

- 이미 있으면 아무것도 바꾸지 않는다. **처음 상태로 되돌리기**(테스트하다 생긴 대화·일정까지 정리): `npm run seed:demo -- --reset`
- 오늘(KST) 이후 날짜의 일기는 넣지 않는다 — 시연 때 오늘 일기는 직접 쓴다.
- 끝에서 AI 기억 저장까지 한다. AI 서버가 꺼져 있었다면 켠 뒤 `npm run memory:reindex`. (`AI_MOCK=true`면 가짜 저장이라 과거의 나 대화도 가짜 답)
- `dist/`의 빌드로 실행하므로 코드를 받은 뒤 한 번은 `npm run build`(또는 `start:dev`가 빌드해 둠).

## API 문서 (Swagger)

- 서버 실행 후 `http://localhost:3000/docs` (UI), `/docs-json` (OpenAPI JSON). `SWAGGER_ENABLED=false`면 끈다.
- 레포 루트의 `openapi.json`이 계약 파일이다. FE는 이 파일로 타입을 만든다:
  `npx openapi-typescript@7.13.0 <openapi.json 경로 또는 raw URL> -o src/api/schema.d.ts`
- DTO·컨트롤러를 바꾸면 `npm run openapi:export` 후 `openapi.json`을 같은 PR에 커밋한다. 안 하면 CI가 실패한다.
- 모든 엔드포인트가 실제로 구현돼 있다 (스텁 없음). AI 없이 개발하려면 `AI_MOCK=true`.

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
| `npm run openapi:export` | `openapi.json` 재생성 |
| `npm run seed:demo` | 시연 계정 만들기 (`-- --reset`이면 처음 상태로 다시) |
| `npm run memory:reindex` | 확정 일기를 AI 기억에 다시 저장 (`-- --all`이면 전부) |

## 브랜치

`develop`(기본) ← `feat/MEA-N-*` PR (squash) · `main` ← `develop` 릴리스 PR (merge commit). 자세한 규칙은 meari-docs의 `dev-flow.md` §4.
