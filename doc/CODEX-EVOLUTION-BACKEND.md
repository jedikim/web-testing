> Language: [English](./CODEX-EVOLUTION-BACKEND.en.md) | [한국어](./CODEX-EVOLUTION-BACKEND.md)

# CODEX EVOLUTION BACKEND

## 0. 목적

버그/예외 처리 실패 시에만 자동으로 "격리된 진화 루프"를 실행해, 새 버전을 안전하게 시험하고 사용자 승인 후 활성 버전으로 전환한다.

핵심 원칙:

1. 트리거 한정: 신규 요구가 아니라 `bug/exception` 트리거에서만 진화 시작
2. 격리 실행: `git worktree`로 별도 후보 버전에서 테스트/수정
3. 모델 분리: 코딩 수정은 `gemini-3.1-pro-preview`, 자동화 실행 판단은 `gemini-3.0-flash`
4. 승인 전환: 테스트 통과 후 `awaiting_approval`에서 사용자 승인 시에만 `promoted`
5. 기록 보존: 시나리오/테스트 로그/자동수정 로그/버전 히스토리를 파일로 저장

## 1. 구성 요소

코드 위치:

1. `runtime/src/evolution/model-policy.ts`: 코딩/자동화 모델 정책 강제
2. `runtime/src/evolution/storage.ts`: 잡/이벤트/활성 버전 포인터/버전 히스토리 저장
3. `runtime/src/evolution/git-sandbox.ts`: worktree 생성, 테스트 실행, promotion 전략
4. `runtime/src/evolution/scenario-growth.ts`: baseline + exception 시나리오 팩 생성
5. `runtime/src/evolution/gemini-autofix.ts`: Gemini 기반 패치 생성/적용(auto-fix)
6. `runtime/src/evolution/service.ts`: 상태머신 오케스트레이션
7. `runtime/src/evolution/server.ts`: HTTP API + SSE 진행 스트림
8. `runtime/src/evolution/auto-improvement-orchestrator.ts`: 실패 결과 기반 자동 진화 트리거
9. `runtime/evolution-ui/*`: 백엔드 테스트용 경량 UI

## 2. 상태 전이

`draft -> sandbox_prepared -> testing -> auto_fixing -> awaiting_approval -> promoted`

실패/거절 분기:

1. 테스트/수정 재시도 소진: `failed`
2. 사용자 거절: `rejected`

상태 이벤트는 `events.json`과 SSE 스트림으로 동시에 제공한다.

## 3. 저장 구조

기본 루트: `testing/evolution/state` (gitignore 대상)

```text
testing/evolution/state/
  jobs/<job-id>/
    job.json
    events.json
    scenario-pack/
      BASELINE.md
      EXCEPTIONS.md
      scenario-pack.json
    attempts/
      attempt-001.log
      attempt-001-autofix.md
      attempt-001.patch.diff
  active-versions/<workflow-id>.json
  version-history/<workflow-id>.json
```

## 4. 승인 후 버전 전환

기본 promotion 모드는 `pointer`다.

1. 후보 브랜치를 즉시 mainline에 머지하지 않는다.
2. `active-versions/<workflow>.json` 포인터를 갱신해 "실행 대상 버전"을 교체한다.
3. 필요 시 `EVOLUTION_PROMOTE_MODE=git-merge`로 전환 가능.

## 5. API

기본 포트: `4777`

1. `GET /health`
2. `GET /evolution/jobs`
3. `POST /evolution/jobs`
4. `GET /evolution/jobs/:id`
5. `POST /evolution/jobs/:id/retry`
6. `POST /evolution/jobs/:id/approve`
7. `POST /evolution/jobs/:id/reject`
8. `GET /evolution/jobs/:id/events`
9. `GET /evolution/jobs/:id/stream` (SSE)
10. `GET /evolution/ui`
11. `POST /evolution/auto-improve` (실패 결과 입력으로 자동 job 생성/완료/선택적 auto-approve)

## 6. 실행 방법

```bash
cd runtime
npm run evolution:server
```

테스트 UI:

1. 브라우저에서 `http://127.0.0.1:4777/evolution/ui`
2. Job 생성 -> SSE watch -> approve/reject/retry

## 7. 환경 변수

1. `EVOLUTION_SERVER_HOST`, `EVOLUTION_SERVER_PORT`
2. `EVOLUTION_REPO_ROOT`, `EVOLUTION_STATE_ROOT`
3. `EVOLUTION_BASE_BRANCH`, `EVOLUTION_TEST_COMMAND`
4. `EVOLUTION_MAX_AUTOFIX_ATTEMPTS`, `EVOLUTION_TEST_TIMEOUT_MS`
5. `EVOLUTION_CODING_MODEL` (기본 `gemini-3.1-pro-preview`)
6. `EVOLUTION_AUTOMATION_MODEL` (기본 `gemini-3.0-flash`)
7. `EVOLUTION_AUTOFIX_ENABLED` (`1`이면 Gemini 패치 자동 적용 시도)
8. `EVOLUTION_PROMOTE_MODE` (`pointer` or `git-merge`)

## 8. 검증 명령

```bash
cd runtime
npm run typecheck
npm run test:evolution
npm test
```

## 9. 참고 사양

1. Git worktree: https://git-scm.com/docs/git-worktree
2. SSE(EventSource): https://developer.mozilla.org/en-US/docs/Web/API/EventSource
3. Node child_process: https://nodejs.org/api/child_process.html
4. Gemini Models API: https://ai.google.dev/api/models#method:-models.list
