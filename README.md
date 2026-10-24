# meari-backend

메아리 API 서버 — NestJS 12 · Prisma · PostgreSQL

인증, 일기 원본 저장, 사진, 체크리스트, 채팅 세션을 담당하고 AI 서버(`meari-ai`)를 호출한다.
설계 문서는 [meari-docs](https://github.com/meari-team/meari-docs) (PRD · ERD · API · ADR · 개발 플로우).

## 시작하기

```bash
npm ci
cp .env.example .env   # 값 채우기
npm run start:dev      # http://localhost:3000
```

## 스크립트

| 명령 | 내용 |
|---|---|
| `npm run start:dev` | 개발 서버 (watch) |
| `npm run lint` | oxlint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | 유닛 테스트 (Vitest) |
| `npm run test:e2e` | e2e 테스트 (Vitest + supertest) |
| `npm run build` | 빌드 |

## 브랜치

`develop`(기본) ← `feat/MEA-N-*` PR (squash) · `main` ← `develop` 릴리스 PR (merge commit). 자세한 규칙은 meari-docs의 `dev-flow.md` §4.
