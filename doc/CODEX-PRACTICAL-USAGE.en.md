> Language: [English](./CODEX-PRACTICAL-USAGE.en.md) | [한국어](./CODEX-PRACTICAL-USAGE.md)

# CODEX Practical Usage Guide

## 0. Purpose

This guide explains real usage patterns for:

1. `backend_simple` (HTTP service usage)
2. `sdk_detailed` (embedded SDK usage)

It follows legal-safe policy: no captcha/2FA bypass automation.

## 1. Legal-Safe Policy (Important)

1. Do not implement captcha solving or bypass logic in production flows.
2. When captcha/2FA/security gates appear, stop automation and request human decision.
3. Resume only after explicit human decision (`go`, `revise`, `not_go`).

## 2. Backend Simple: End-to-End Practical Flow

### 2.1 Start server

```bash
cd runtime
npm run backend:simple:server
```

Default URL: `http://127.0.0.1:4888`

### 2.2 Create a session

```bash
curl -s http://127.0.0.1:4888/backend/sessions \
  -H 'content-type: application/json' \
  -d '{
    "mode": "backend_simple",
    "title": "Pangyo weather + kid places",
    "workflowId": "wf-kr-planner",
    "systemPrompt": "Use deterministic-first and request screenshot checkpoints for unclear states."
  }'
```

### 2.3 Send user turn

```bash
curl -s http://127.0.0.1:4888/backend/sessions/<SESSION_ID>/turns \
  -H 'content-type: application/json' \
  -d '{
    "content": "Check today weather, then suggest kid-friendly places near Seoul from Pangyo.",
    "screenshotPath": "testing/backend/state/example-step1.png"
  }'
```

### 2.4 Read session history

```bash
curl -s http://127.0.0.1:4888/backend/sessions/<SESSION_ID>
```

### 2.5 Close session

```bash
curl -s -X POST http://127.0.0.1:4888/backend/sessions/<SESSION_ID>/close \
  -H 'content-type: application/json' \
  -d '{}'
```

## 3. SDK Detailed: Embedded Practical Flow

### 3.1 Basic multi-turn usage

```ts
import { createMultiTurnAutomationSdk } from '../src/index';

const sdk = createMultiTurnAutomationSdk();

const session = await sdk.createSession({
  mode: 'sdk_detailed',
  title: 'kr multi-step planner',
  workflowId: 'wf-kr-complex'
});

const turn = await sdk.sendUserTurn({
  sessionId: session.id,
  content: 'Start from weather, then map search, then shortlist 3 places.'
});

console.log(turn.assistantTurn.content);
```

Run local example:

```bash
cd runtime
npm run example:sdk:multiturn
```

### 3.2 Human handoff flow example

```bash
cd runtime
npm run example:sdk:human-handoff
```

This example demonstrates policy-safe interruption where automation is blocked and awaits human decision.

## 4. Human Handoff Contract

Core runtime contract:

- `runHumanLoop(...)` from integration layer
- decision input: `workflowId`, `screenshotPath`, `question`
- decision output: `go | revise | not_go | unknown`

Behavior:

1. `go`: continue
2. `revise`: apply revision function and retry
3. `not_go` or `unknown`: stop with `blocked`

## 5. Recommended Operational Checklist

1. Keep `PW_HEADLESS=0` for practical validation.
2. Save screenshots for every uncertain checkpoint.
3. Keep all runtime/testing artifacts under gitignored `testing/`.
4. Keep coding model as `gemini-3.1-pro-preview`.
5. Keep automation interaction model as `gemini-3.0-flash`.

## 6. Where to Read Next

- SDK + Backend usage: [CODEX-SDK-BACKEND-USAGE.en.md](./CODEX-SDK-BACKEND-USAGE.en.md)
- Environment setup: [CODEX-ENV-SETUP.en.md](./CODEX-ENV-SETUP.en.md)
- Runbook: [CODEX-RUNBOOK.en.md](./CODEX-RUNBOOK.en.md)
