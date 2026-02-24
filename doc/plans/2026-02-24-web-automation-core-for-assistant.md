> Language: [English](./2026-02-24-web-automation-core-for-assistant.en.md) | [한국어](./2026-02-24-web-automation-core-for-assistant.md)

# Web Automation Core For Assistant Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 외부 AI 비서 프로젝트가 Slack/Telegram 연동을 담당할 때, 이 저장소는 채널 비종속 웹 자동화 코어를 안정적으로 제공한다.

**Architecture:** 웹 자동화 런타임은 `workflow -> engine -> fallback/vision -> human-loop port` 구조를 유지한다. 채널/webhook/봇 SDK는 본 저장소에서 구현하지 않고, `DecisionPort` 계약만 노출한다.

**Tech Stack:** TypeScript, Playwright, Vitest

---

## Scope Boundary

이 계획은 다음을 **포함하지 않는다**:
1. Slack Events API 구현
2. Telegram Bot API 구현
3. webhook 서명 검증/배포 운영

이 계획은 다음을 **포함한다**:
1. 채널 비종속 승인 루프
2. workflow/action 브리지 고도화
3. 스크린샷/아티팩트 계약 강화
4. 외부 프로젝트가 붙기 쉬운 포트/문서 제공

---

### Task 1: Human-Loop Port Stabilization

**Files:**
- Create: `runtime/src/integration/human-loop-runtime.ts`
- Test: `runtime/tests/human-loop-runtime.test.ts`
- Modify: `runtime/src/chat/screenshot-chat-loop.ts`

**Step 1: Write failing test**
- `runHumanLoop`의 `revise`, `not_go` 흐름 테스트 작성

**Step 2: Verify fail**
- Run: `cd runtime && npm test -- tests/human-loop-runtime.test.ts`

**Step 3: Minimal implementation**
- `DecisionPort` + `runHumanLoop` 구현
- 기존 chat loop는 이 코어를 어댑팅

**Step 4: Verify pass**
- Run: `cd runtime && npm test -- tests/human-loop-runtime.test.ts tests/screenshot-chat-loop.test.ts`

**Step 5: Commit**
- `feat(integration): add channel-agnostic human-loop runtime`

---

### Task 2: Workflow/Engine Integration Contracts

**Files:**
- Modify: `runtime/src/workflow/types.ts`
- Create: `runtime/src/engine/node-action-mapper.ts`
- Create: `runtime/src/engine/playwright-workflow-adapter.ts`
- Test: `runtime/tests/node-action-mapper.test.ts`
- Test: `runtime/tests/playwright-workflow-adapter.test.ts`

**Step 1: Write failing tests**
- node의 `target/args` 매핑 테스트
- unsupported op 실패 코드 테스트

**Step 2: Verify fail**
- Run: `cd runtime && npm test -- tests/node-action-mapper.test.ts tests/playwright-workflow-adapter.test.ts`

**Step 3: Minimal implementation**
- workflow node -> `ExecutorAction` 변환기 추가
- deterministic adapter와 Playwright executor 연결

**Step 4: Verify pass**
- Run: `cd runtime && npm test -- tests/node-action-mapper.test.ts tests/playwright-workflow-adapter.test.ts tests/deterministic-runner.test.ts`

**Step 5: Commit**
- `feat(engine): map workflow nodes to executor actions`

---

### Task 3: Artifact & Screenshot Contract Hardening

**Files:**
- Create: `runtime/src/artifacts/artifact-writer.ts`
- Create: `runtime/src/artifacts/path-policy.ts`
- Test: `runtime/tests/artifact-writer.test.ts`
- Modify: `runtime/src/types/run-artifact.ts`

**Step 1: Write failing tests**
- run artifact 경로/필수 필드 저장 테스트

**Step 2: Verify fail**
- Run: `cd runtime && npm test -- tests/artifact-writer.test.ts`

**Step 3: Minimal implementation**
- 날짜 기반 경로 정책 + JSON 저장기

**Step 4: Verify pass**
- Run: `cd runtime && npm test -- tests/artifact-writer.test.ts`

**Step 5: Commit**
- `feat(artifacts): add deterministic artifact writer`

---

### Task 4: Core Boundary Documentation

**Files:**
- Create: `doc/CODEX-INTEGRATION-BOUNDARY.md`
- Modify: `runtime/README.md`
- Modify: `AGENTS.md`

**Step 1: Write doc changes**
- 코어/외부 비서 책임 경계 명시

**Step 2: Verify**
- 문서 링크/경로 확인

**Step 3: Commit**
- `docs: define automation-core and assistant integration boundary`

---

### Task 5: Final Verification Gate

**Files:**
- Modify: `doc/CODEX-IMPLEMENTATION-PLAN.md`
- (Optional) Add: `runs/samples/*review.md`

**Step 1: Run full verification**
- `cd runtime && npm test`
- `cd runtime && npm run test:acceptance`
- `cd runtime && npm run typecheck`
- `./scripts/validate-run-artifacts.sh`

**Step 2: Record evidence**
- 테스트 수/통과 결과 문서 반영

**Step 3: Commit**
- `docs: update implementation evidence for assistant-core scope`
