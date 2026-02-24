> Language: [English](./CODEX-E2E-TESTING.en.md) | [한국어](./CODEX-E2E-TESTING.md)

# CODEX E2E TESTING

## 0. Purpose

Provide reproducible E2E validation for real usage conditions.

## 1. E2E Layers

1. contract tests
2. KR live smoke
3. assistantless chat-loop simulation
4. provider matrix (LLM + YOLO26; gemini/openai only)
5. evolution backend loop
6. SDK/backend contract tests
7. external assistant integration (external project)

## 2. KR Live Scenarios

Defined in: `runtime/src/e2e/kr-scenarios.ts`

Examples:
- naver home + search box
- naver weather query
- daum home + search box
- daum news query
- naver news home
- naver finance home

## 3. Assistantless Complex Scenarios

Defined in: `runtime/tests/assistantless-chat-e2e.test.ts` and `runtime/tests/e2e-autonomous-batch-kr-live.test.ts`

Includes:
- initial LLM then rule-first
- revise and vision-assisted retry
- captcha chain (`YOLO26 -> VLM -> LLM solve retry`)
- blocked sensitive gate path
- long-step multi-site planning scenarios

## 4. Commands

```bash
cd runtime
npm run test:e2e:kr:contract
npm run test:e2e:kr
npm run test:e2e:kr:headful
npm run test:e2e:assistantless:contract
npm run test:e2e:assistantless:live
npm run test:e2e:autonomous:live
npm run test:provider:contract
npm run test:evolution
npm run test:sdk
# optional with live credentials
npm run test:e2e:provider:live
```

## 5. Artifact Paths

- KR smoke: `runs/samples/artifacts/e2e/YYYY-MM-DD/`
- Autonomous batch: `testing/autonomous-batch/<run>/`
- Evolution state: `testing/evolution/state/`

Required autonomous run files:
- `PLANNING.md`, `WORKFLOW.md`, `summary.md`, `summary.json`, `FINAL-OPTIMIZED-RESULT.md`
- per scenario: `PLAN.md`, `WORKFLOW.md`, `process.md`, `result.json`, screenshots

## 6. Operational Rules

1. live tests are opt-in
2. no login/payment/personal-data writing in default scenarios
3. do not delete flaky scenarios; quarantine and document
4. evolution is for bug/exception failures, not for every new feature request
