> Language: [English](./2026-02-24-assistantless-chat-loop-e2e-plan.en.md) | [한국어](./2026-02-24-assistantless-chat-loop-e2e-plan.md)

# Assistantless Chat-Loop E2E Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** AI 비서 연동 없이도 웹 자동화 코어가 `스크린샷 공유 + LLM 분석 + rule-first 반복 + 실패 시 revise/not_go` 루프를 E2E로 검증하도록 만든다.

**Architecture:** `runtime/src/testing`에 assistantless 오케스트레이터를 추가하고, 테스트는 계약/수용(phase acceptance)/문서 동기화로 구성한다. 브라우저 라이브 검증은 headful 경로(`PW_HEADLESS=0`)를 기본 운영 명령으로 분리한다.

**Tech Stack:** TypeScript, Vitest, Playwright

---

### Task 1: Assistantless E2E 계약 테스트 작성

**Files:**
- Create: `runtime/tests/assistantless-chat-e2e.test.ts`
- Test: `runtime/tests/assistantless-chat-e2e.test.ts`

**Step 1: Write the failing test**

```ts
import { runAssistantlessChatE2E } from '../src/testing/assistantless-chat-e2e';
```

**Step 2: Run test to verify it fails**

Run: `cd runtime && npm test -- tests/assistantless-chat-e2e.test.ts`  
Expected: 모듈 없음 오류

**Step 3: Write minimal implementation**

```ts
export async function runAssistantlessChatE2E(...) { ... }
```

**Step 4: Run test to verify it passes**

Run: `cd runtime && npm test -- tests/assistantless-chat-e2e.test.ts`  
Expected: 3 tests pass

### Task 2: 수용 테스트/스크립트/경계 문서 동기화

**Files:**
- Modify: `runtime/tests/phase-acceptance.test.ts`
- Modify: `runtime/package.json`
- Modify: `AGENTS.md`
- Modify: `doc/CODEX-E2E-TESTING.md`
- Modify: `doc/CODEX-AUTOMATION-TEST-PLAN.md`
- Modify: `runtime/README.md`

**Step 1: 수용 테스트에 assistantless 케이스 추가**

```ts
it('phase3+: assistantless chat-loop e2e ...', async () => { ... });
```

**Step 2: headful/assistantless 스크립트 추가**

```json
"test:e2e:kr:headful": "PW_HEADLESS=0 RUN_KR_E2E=1 vitest run tests/e2e-kr-live.test.ts",
"test:e2e:assistantless:contract": "vitest run tests/assistantless-chat-e2e.test.ts"
```

**Step 3: 경계 문서 보강**

- AI 비서 연동(webhook/session/prompt)은 외부 프로젝트 범위
- 이 저장소는 assistantless simulation + core contract 범위

### Task 3: 모델/비전 운영 현실화

**Files:**
- Modify: `runtime/src/llm/model-registry.ts`
- Modify: `runtime/src/config/provider-matrix-env.ts`
- Modify: `runtime/src/testing/provider-model-matrix.ts`
- Modify: `runtime/src/testing/provider-http-executor.ts`
- Modify: `runtime/tests/provider-matrix-env.test.ts`
- Modify: `runtime/tests/provider-http-executor.test.ts`
- Modify: `runtime/.env.example`
- Modify: `doc/CODEX-ENV-SETUP.md`

**Step 1: Gemini 기본 모델 우선순위 조정**

- 기본 Gemini 모델을 `gemini-3.0-flash` 우선으로 변경

**Step 2: YOLO26 로컬 오픈소스 경로 허용**

- `YOLO26_API_KEY`를 선택값으로 변경
- API key 없는 경우도 `/detect` 호출 가능하게 수정

**Step 3: 회귀 테스트 추가**

- `provider-matrix-env`에서 key 없는 YOLO26 케이스 pass
- `provider-http-executor`에서 Authorization 없이 비전 호출 pass

### Task 4: 검증

**Step 1: 계약/수용/회귀 테스트**

Run:

```bash
cd runtime
npm run test:e2e:assistantless:contract
npm run test:provider:contract
npm run test:full-flow
npm run test:acceptance
npm test
npm run typecheck
```

**Step 2: Headful 라이브 확인**

Run:

```bash
cd runtime
npm run test:e2e:kr:headful
```

**Step 3: 아티팩트 규칙 검증**

Run: `cd .. && ./scripts/validate-run-artifacts.sh`
