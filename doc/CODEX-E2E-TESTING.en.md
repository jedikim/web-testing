> Language: [English](./CODEX-E2E-TESTING.en.md) | [한국어](./CODEX-E2E-TESTING.md)

# CODEX E2E TESTING

Last Updated: 2026-02-25 (KST)

## 0. Purpose

Provide practical, reproducible E2E validation for:
1. deterministic runtime behavior
2. recovery behavior under drift/failure
3. chat-style automation operation
4. provider/live integration readiness

## 1. Layer Model

1. Contract layer: schema and test contracts
2. Fixture deterministic E2E layer
3. KR live smoke layer
4. Assistantless live loop layer
5. Autonomous batch layer
6. Provider matrix layer
7. Evolution backend and SDK layer

## 2. Command Map

```bash
cd runtime
npm run test:e2e:fixtures
npm run test:e2e:kr:contract
npm run test:e2e:kr:headful
npm run test:e2e:assistantless:contract
npm run test:e2e:assistantless:live
npm run test:e2e:autonomous:live
npm run test:provider:contract
npm run test:e2e:provider:live
npm run test:evolution
npm run test:sdk
```

## 3. Live Flags Explained

1. `RUN_KR_E2E=1`
- enables Korea live smoke scenarios

2. `RUN_ASSISTANTLESS_KR_E2E=1`
- enables assistantless live chat-loop scenarios

3. `RUN_PROVIDER_LIVE_E2E=1`
- enables live provider matrix tests
- matrix run executes only when provider/model targets are configured in env

4. `RUN_AUTONOMOUS_BATCH_E2E=1`
- enables autonomous multi-scenario batch runs
- outputs evidence to `testing/autonomous-batch/`

5. `PW_HEADLESS=0`
- headful browser mode (recommended for practical validation)

## 4. Core Scenario Sources

1. KR live smoke: `runtime/src/e2e/kr-scenarios.ts`
2. Assistantless simulation: `runtime/tests/assistantless-chat-e2e.test.ts`
3. Autonomous batch: `runtime/tests/e2e-autonomous-batch-kr-live.test.ts`
4. Provider live matrix: `runtime/tests/e2e-provider-live.test.ts`
5. Chat UI E2E: `runtime/tests/chat-automation-ui-e2e.test.ts`

## 5. Expected Evidence

KR smoke:
- `runs/samples/artifacts/e2e/YYYY-MM-DD/*.png|*.json`

Assistantless live:
- `runs/samples/artifacts/e2e-assistantless/YYYY-MM-DD/*`

Autonomous batch:
- `testing/autonomous-batch/<run>/PLANNING.md`
- `testing/autonomous-batch/<run>/WORKFLOW.md`
- `testing/autonomous-batch/<run>/summary.md`
- `testing/autonomous-batch/<run>/summary.json`
- `testing/autonomous-batch/<run>/FINAL-OPTIMIZED-RESULT.md`
- per-scenario iteration folders with `process.md`, `result.json`, screenshots, `PLAN.md`, `WORKFLOW.md`

## 6. Pass/Fail Policy

1. contract/fixture/unit layers must pass fully
2. live failures must include screenshot/json evidence
3. flaky live cases should be quarantined and documented, not silently removed
4. provider live matrix can be skipped only when env targets are not configured

## 7. Safety Policy

1. do not automate login/payment/personal-data write paths by default
2. do not bypass captcha/2FA/security challenges
3. use explicit human handoff for security checkpoints
