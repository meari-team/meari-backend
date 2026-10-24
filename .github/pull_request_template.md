## 무엇을
<!-- 한두 문장 -->

## 왜
Closes #

## 어떻게 확인했나
- [ ] 유닛/e2e 테스트
- [ ] 로컬(실기기/시뮬레이터)에서 직접 확인
- [ ] (FE) 로딩 / 빈 / 에러 상태 확인

## 🔒 보안 체크
- [ ] 입력 검증 (DTO + class-validator)
- [ ] userId는 토큰에서만, 조회·수정·삭제에 소유자 조건
- [ ] 응답 DTO에 passwordHash·storageKey·imageAnalysis 원본 등 내부 필드 없음
- [ ] raw SQL은 `$queryRaw` 템플릿만 (`Unsafe` 금지)
- [ ] 시크릿 하드코딩 없음, 로그에 일기 본문·토큰 없음
- [ ] (AI 연동) AI 서버로 보내는 `user_id`는 토큰 값, references는 재검증
- [ ] (AI 계약 변경) AI_API_SPEC.md · meari-docs/api.md §4 갱신
- [ ] 커밋·PR에 AI 도구 작성 표시(Co-Authored-By 등) 없음

## 스크린샷 (UI 변경 시)
