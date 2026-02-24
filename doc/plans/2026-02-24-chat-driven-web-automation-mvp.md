> Language: [English](./2026-02-24-chat-driven-web-automation-mvp.en.md) | [한국어](./2026-02-24-chat-driven-web-automation-mvp.md)

# Chat-Driven Web Automation MVP Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Telegram/Slack 대화를 통해 웹 자동화를 단계적으로 완성하고, 필요 시점 스크린샷 승인(`go/not_go/revise`)으로 안전하게 실행하는 단일 노드(Mini PC/Mac mini) MVP를 운영 가능 상태로 만든다.

**Architecture:** TypeScript runtime를 HTTP webhook 서비스로 승격하고, Chat Gateway(telegram/slack) -> Checkpoint Broker -> Workflow Runner -> Playwright Session -> Artifact Store 흐름으로 구성한다. 현재 순수 함수/유닛 중심 모듈을 실제 I/O(웹훅, 브라우저, 파일, SQLite, LLM provider interface)로 연결한다. 결정론 실행을 기본으로 유지하고 실패 구간만 patch-only 복구와 사용자 질의로 처리한다.

**Tech Stack:** Node.js 20+, TypeScript, Playwright, Vitest, SQLite (`better-sqlite3`), Telegram Bot API, Slack Events API, OpenAI-compatible LLM client(추상 인터페이스)

---

## Readiness Verdict (2026-02-24)

현재 상태는 **라이브러리/시뮬레이션 PoC로는 사용 가능**하지만, 요청한 "챗으로 대화하면서 자동화를 완성"하는 운영형 AI 비서로는 아직 불충분하다.

핵심 갭:
1. Chat transport 구현 없음 (`ChatAdapter`는 인터페이스만 존재)
2. webhook/server 엔트리포인트 없음 (`runtime/package.json`은 test/typecheck 스크립트만 존재)
3. workflow node -> Playwright action 브리지 없음
4. checkpoint/run/recipe 영속 저장소 없음(대부분 메모리 기반)
5. 실제 LLM/VLM 호출 경계 구현이 callback 스텁 수준

---

### Task 1: Runtime Service Skeleton (Webhook Host)

**Files:**
- Create: `runtime/src/app/server.ts`
- Create: `runtime/src/app/routes.ts`
- Create: `runtime/src/app/config.ts`
- Create: `runtime/src/app/index.ts`
- Modify: `runtime/package.json`
- Test: `runtime/tests/app-server.test.ts`

**Step 1: Write the failing test**

```ts
it('serves /health and accepts webhook routes', async () => {
  const app = buildServer({});
  const health = await app.inject({ method: 'GET', url: '/health' });
  expect(health.statusCode).toBe(200);

  const telegram = await app.inject({ method: 'POST', url: '/webhook/telegram', payload: {} });
  expect([200, 400, 401]).toContain(telegram.statusCode);
});
```

**Step 2: Run test to verify it fails**

Run: `cd runtime && npm test -- app-server.test.ts`
Expected: FAIL with `Cannot find module '../src/app/server'`

**Step 3: Write minimal implementation**

- Node HTTP server + route dispatcher 구현
- `/health`, `/webhook/telegram`, `/webhook/slack` route 추가
- graceful shutdown handler(`SIGINT`, `SIGTERM`) 추가

**Step 4: Run test to verify it passes**

Run: `cd runtime && npm test -- app-server.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add runtime/src/app runtime/tests/app-server.test.ts runtime/package.json
git commit -m "feat(app): add runtime webhook host skeleton"
```

---

### Task 2: Telegram/Slack Transport + Signature Validation

**Files:**
- Create: `runtime/src/chat/telegram-adapter.ts`
- Create: `runtime/src/chat/slack-adapter.ts`
- Create: `runtime/src/chat/webhook-auth.ts`
- Modify: `runtime/src/chat/types.ts`
- Modify: `runtime/src/chat/platform-normalizer.ts`
- Test: `runtime/tests/telegram-adapter.test.ts`
- Test: `runtime/tests/slack-adapter.test.ts`
- Test: `runtime/tests/webhook-auth.test.ts`

**Step 1: Write failing tests**

- telegram adapter가 text + screenshot 전송 시 multipart 호출하는지 검증
- slack adapter가 channel/postMessage payload를 정상 구성하는지 검증
- Slack signature timestamp/hash 검증 실패/성공 케이스 검증

**Step 2: Run tests to verify they fail**

Run: `cd runtime && npm test -- telegram-adapter.test.ts slack-adapter.test.ts webhook-auth.test.ts`
Expected: FAIL (modules missing)

**Step 3: Write minimal implementation**

- `ChatAdapter`에 `send` 유지, 실구현 클래스 2종 추가
- webhook 서명 검증 유틸 추가(재사용 가능 함수)
- retry 가능한 HTTP client wrapper 추가(429/5xx 백오프)

**Step 4: Run tests to verify they pass**

Run: `cd runtime && npm test -- telegram-adapter.test.ts slack-adapter.test.ts webhook-auth.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add runtime/src/chat runtime/tests/telegram-adapter.test.ts runtime/tests/slack-adapter.test.ts runtime/tests/webhook-auth.test.ts
git commit -m "feat(chat): implement telegram/slack transport and webhook auth"
```

---

### Task 3: Checkpoint Correlation + Persistent State (SQLite)

**Files:**
- Create: `runtime/src/state/db.ts`
- Create: `runtime/src/state/checkpoint-store.ts`
- Create: `runtime/src/state/run-store.ts`
- Modify: `runtime/src/chat/screenshot-checkpoint.ts`
- Modify: `runtime/src/chat/screenshot-chat-loop.ts`
- Test: `runtime/tests/checkpoint-store.test.ts`
- Test: `runtime/tests/run-store.test.ts`
- Test: `runtime/tests/screenshot-checkpoint.test.ts`

**Step 1: Write failing tests**

- checkpoint 생성/조회/만료/중복응답 방지 테스트
- 프로세스 재시작 후 checkpoint 복원 테스트
- `cp_###` 응답이 올바른 workflow/session에만 매핑되는지 테스트

**Step 2: Run tests to verify they fail**

Run: `cd runtime && npm test -- checkpoint-store.test.ts run-store.test.ts screenshot-checkpoint.test.ts`
Expected: FAIL (store modules missing)

**Step 3: Write minimal implementation**

- SQLite schema: `checkpoints`, `runs`, `events`
- `ScreenshotCheckpointBroker`를 in-memory map에서 store 기반으로 전환
- timeout/expiry + idempotency key 도입

**Step 4: Run tests to verify they pass**

Run: `cd runtime && npm test -- checkpoint-store.test.ts run-store.test.ts screenshot-checkpoint.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add runtime/src/state runtime/src/chat/screenshot-checkpoint.ts runtime/src/chat/screenshot-chat-loop.ts runtime/tests/checkpoint-store.test.ts runtime/tests/run-store.test.ts runtime/tests/screenshot-checkpoint.test.ts
git commit -m "feat(state): persist checkpoints and run states with sqlite"
```

---

### Task 4: Workflow Node -> Playwright Bridge

**Files:**
- Create: `runtime/src/engine/node-action-mapper.ts`
- Create: `runtime/src/engine/playwright-workflow-adapter.ts`
- Modify: `runtime/src/workflow/types.ts`
- Modify: `runtime/src/engine/deterministic-runner.ts`
- Modify: `runtime/src/engine/playwright-executor.ts`
- Test: `runtime/tests/node-action-mapper.test.ts`
- Test: `runtime/tests/playwright-workflow-adapter.test.ts`
- Test: `runtime/tests/deterministic-runner.test.ts`

**Step 1: Write failing tests**

- `ActionNode`의 `target/args`가 `ExecutorAction`으로 매핑되는지 검증
- `NavigateNode/VerifyNode/CheckpointNode` 최소 동작 브리지 검증
- 기존 deterministic 테스트가 회귀 없이 통과하는지 검증

**Step 2: Run tests to verify they fail**

Run: `cd runtime && npm test -- node-action-mapper.test.ts playwright-workflow-adapter.test.ts deterministic-runner.test.ts`
Expected: FAIL (mapping layer missing)

**Step 3: Write minimal implementation**

- `WorkflowNodeBase` 확장: `target?: string`, `args?: Record<string, unknown>`
- adapter가 `WorkflowNode`를 해석해 Playwright executor 호출
- unsupported op는 명시적 실패 코드 반환

**Step 4: Run tests to verify they pass**

Run: `cd runtime && npm test -- node-action-mapper.test.ts playwright-workflow-adapter.test.ts deterministic-runner.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add runtime/src/engine runtime/src/workflow/types.ts runtime/tests/node-action-mapper.test.ts runtime/tests/playwright-workflow-adapter.test.ts runtime/tests/deterministic-runner.test.ts
git commit -m "feat(engine): bridge workflow nodes to playwright actions"
```

---

### Task 5: Screenshot Artifact Pipeline

**Files:**
- Create: `runtime/src/artifacts/artifact-writer.ts`
- Create: `runtime/src/artifacts/screenshot-capture.ts`
- Create: `runtime/src/artifacts/path-policy.ts`
- Modify: `runtime/src/types/run-artifact.ts`
- Modify: `runtime/src/chat/screenshot-chat-loop.ts`
- Test: `runtime/tests/artifact-writer.test.ts`
- Test: `runtime/tests/screenshot-capture.test.ts`
- Test: `runtime/tests/phase-acceptance.test.ts`

**Step 1: Write failing tests**

- run 종료 시 JSON artifact가 `runs/YYYY/MM/DD`에 저장되는지 검증
- checkpoint 시점 screenshot 파일 저장/경로 참조 검증
- 민감 액션 전 screenshot 강제 정책 검증

**Step 2: Run tests to verify they fail**

Run: `cd runtime && npm test -- artifact-writer.test.ts screenshot-capture.test.ts phase-acceptance.test.ts`
Expected: FAIL (artifact modules missing)

**Step 3: Write minimal implementation**

- 파일 저장 유틸 + 경로 규칙 구현
- Playwright `page.screenshot()` 캡처 어댑터 구현
- chat outbound에 artifact 경로 일관 전달

**Step 4: Run tests to verify they pass**

Run: `cd runtime && npm test -- artifact-writer.test.ts screenshot-capture.test.ts phase-acceptance.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add runtime/src/artifacts runtime/src/types/run-artifact.ts runtime/src/chat/screenshot-chat-loop.ts runtime/tests/artifact-writer.test.ts runtime/tests/screenshot-capture.test.ts runtime/tests/phase-acceptance.test.ts
git commit -m "feat(artifacts): add screenshot and run artifact pipeline"
```

---

### Task 6: LLM-Assisted Revise Path (Provider Interface)

**Files:**
- Create: `runtime/src/llm/types.ts`
- Create: `runtime/src/llm/provider.ts`
- Create: `runtime/src/llm/patch-generator.ts`
- Modify: `runtime/src/fallback/auto-recovery.ts`
- Modify: `runtime/src/vision/visual-recovery.ts`
- Test: `runtime/tests/patch-generator.test.ts`
- Test: `runtime/tests/auto-recovery.test.ts`
- Test: `runtime/tests/visual-recovery.test.ts`

**Step 1: Write failing tests**

- 후보 축약 컨텍스트 입력 시 patch-only JSON만 반환 허용 테스트
- malformed patch/forbidden path 차단 테스트
- `revise` 응답 시 LLM 1회 호출 제한 테스트

**Step 2: Run tests to verify they fail**

Run: `cd runtime && npm test -- patch-generator.test.ts auto-recovery.test.ts visual-recovery.test.ts`
Expected: FAIL

**Step 3: Write minimal implementation**

- provider 인터페이스 + mock provider + OpenAI-compatible provider 구현
- JSON schema validation + budget guard(step/task) 추가
- 실패 시 `ask_user` 또는 `not_go`로 안전 전환

**Step 4: Run tests to verify they pass**

Run: `cd runtime && npm test -- patch-generator.test.ts auto-recovery.test.ts visual-recovery.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add runtime/src/llm runtime/src/fallback/auto-recovery.ts runtime/src/vision/visual-recovery.ts runtime/tests/patch-generator.test.ts runtime/tests/auto-recovery.test.ts runtime/tests/visual-recovery.test.ts
git commit -m "feat(llm): add patch-only revise path with provider abstraction"
```

---

### Task 7: End-to-End Chat Scenario + Ops Packaging

**Files:**
- Create: `runtime/tests/e2e-chat-automation.test.ts`
- Create: `runtime/scripts/run-local-smoke.sh`
- Create: `doc/CODEX-DEPLOY-MINI-NODE.md`
- Modify: `doc/CODEX-RUNBOOK.md`
- Modify: `doc/CODEX-IMPLEMENTATION-PLAN.md`
- Modify: `runtime/package.json`

**Step 1: Write failing E2E test**

- 시나리오: `start -> screenshot 질문 -> revise -> pass`를 telegram/slack mock transport로 검증
- artifact 파일 + chat trace + review trace 생성 검증

**Step 2: Run test to verify it fails**

Run: `cd runtime && npm test -- e2e-chat-automation.test.ts`
Expected: FAIL

**Step 3: Write minimal implementation**

- local smoke script(환경변수 체크, webhook 모의 호출) 추가
- 운영 문서(launchd/systemd, env var, secret rotation, backup) 추가
- package script(`start`, `dev`, `smoke`) 추가

**Step 4: Run full verification**

Run:
- `cd runtime && npm test`
- `cd runtime && npm run test:acceptance`
- `cd runtime && npm run typecheck`
- `./scripts/validate-run-artifacts.sh`
Expected: All PASS

**Step 5: Commit**

```bash
git add runtime/tests/e2e-chat-automation.test.ts runtime/scripts/run-local-smoke.sh doc/CODEX-DEPLOY-MINI-NODE.md doc/CODEX-RUNBOOK.md doc/CODEX-IMPLEMENTATION-PLAN.md runtime/package.json
git commit -m "feat(mvp): complete e2e chat-driven automation baseline"
```

---

## Exit Criteria (MVP Ready)

1. Telegram 또는 Slack 중 최소 1개 채널에서 실제 대화형 checkpoint가 동작한다.
2. 단일 시나리오를 5회 반복 실행했을 때 완료율 80% 이상, 치명적 오동작 0건.
3. `go/not_go/revise` 의사결정과 스크린샷/아티팩트가 모두 추적 가능하다.
4. 민감 액션(제출/결제/계정변경)은 사용자 승인 없이는 차단된다.
5. 서비스 재시작 후에도 pending checkpoint와 run 상태가 복원된다.

## Rollout Strategy

1. Local dry-run(모의 transport) -> 2. Private Telegram 파일럿 -> 3. Slack 파일럿 -> 4. 개인 운영 배포(systemd/launchd)
2. 각 단계마다 실패 유형 상위 3개를 룰로 승격하고 재실행 지표를 기록한다.
3. 파일럿 단계에서는 자동 `revise`를 기본 OFF로 두고, 승인 후 ON으로 전환한다.
