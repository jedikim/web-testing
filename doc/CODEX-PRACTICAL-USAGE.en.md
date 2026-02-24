> Language: [English](./CODEX-PRACTICAL-USAGE.en.md) | [한국어](./CODEX-PRACTICAL-USAGE.md)

# CODEX Practical Usage Guide

## 0. Purpose

This guide explains real usage patterns for:

1. `backend_simple` (HTTP service usage)
2. `chat_automation_example` (chat-style control with live logs/progress)
3. `sdk_detailed` (embedded SDK usage)

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

## 3. Chat Automation Example Backend: Practical Flow

### 3.1 Start backend + chat UI

```bash
cd runtime
npm run example:chat-backend
```

Default URL: `http://127.0.0.1:4999/example/chat/ui`

### 3.2 Create session and send first objective

```bash
curl -s http://127.0.0.1:4999/example/chat/sessions \
  -H 'content-type: application/json' \
  -d '{
    "title": "Pangyo planner",
    "operatorId": "operator-main"
  }'
```

```bash
curl -s http://127.0.0.1:4999/example/chat/sessions/<SESSION_ID>/message \
  -H 'content-type: application/json' \
  -d '{
    "content": "Open naver.com and plan family-friendly places near Pangyo after weather check.",
    "browserMode": "headful",
    "operatorId": "operator-main",
    "autoPauseOthers": true
  }'
```

### 3.3 Watch progress and logs continuously

```bash
curl -N http://127.0.0.1:4999/example/chat/sessions/<SESSION_ID>/stream
```

This stream emits runtime step updates and log entries that the sample UI renders in real time.

### 3.4 Pause old session when new conversation starts

If another session with the same `operatorId` receives a new message and `autoPauseOthers=true`, older running session moves to `paused`.

### 3.5 Human input for captcha/security challenge

When run status becomes `waiting_captcha`, submit explicit user input:

```bash
curl -s http://127.0.0.1:4999/example/chat/sessions/<SESSION_ID>/captcha \
  -H 'content-type: application/json' \
  -d '{"value":"A1B2C3"}'
```

Then continue with:

```bash
curl -s http://127.0.0.1:4999/example/chat/sessions/<SESSION_ID>/resume \
  -H 'content-type: application/json' \
  -d '{}'
```

## 4. SDK Detailed: Embedded Practical Flow

### 4.1 Basic multi-turn usage

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

### 4.2 Human handoff flow example

```bash
cd runtime
npm run example:sdk:human-handoff
```

This example demonstrates policy-safe interruption where automation is blocked and awaits human decision.

### 4.3 Repeated listing image composite (YOLO -> VLM fallback)

Use this when list items are visually repetitive:

1. merge item images into one composite image
2. run YOLO26 on the composite first
3. if YOLO is uncertain, run VLM on the same composite image
4. reverse-map detections back to original item IDs

```ts
const result = await runAssistantlessChatE2E({
  ...baseInput,
  shouldRunRepeatedItemComposite: async () => true,
  collectRepeatedItemImages: async () => itemImages,
  judgeRepeatedItemsWithYolo: async ({ compositeImagePath, manifest }) => {
    return yoloJudge(compositeImagePath, manifest);
  },
  judgeRepeatedItemsWithVlm: async ({ compositeImagePath, yolo, mappedDetections }) => {
    return vlmJudge(compositeImagePath, yolo, mappedDetections);
  }
});
```

Relevant code:

- `runtime/src/vision/composite-sheet.ts`
- `runtime/src/vision/repeated-item-judgement.ts`
- `runtime/src/testing/assistantless-chat-e2e.ts`

Runnable example:

```bash
cd runtime
npm run example:repeated-item
```

## 5. Human Handoff Contract

Core runtime contract:

- `runHumanLoop(...)` from integration layer
- decision input: `workflowId`, `screenshotPath`, `question`
- decision output: `go | revise | not_go | unknown`

Behavior:

1. `go`: continue
2. `revise`: apply revision function and retry
3. `not_go` or `unknown`: stop with `blocked`

## 6. Recommended Operational Checklist

1. Keep `PW_HEADLESS=0` for practical validation.
2. Save screenshots for every uncertain checkpoint.
3. Keep all runtime/testing artifacts under gitignored `testing/`.
4. Keep coding model as `gemini-3.1-pro-preview`.
5. Keep automation interaction model as `gemini-3.0-flash`.

## 7. Where to Read Next

- SDK + Backend usage: [CODEX-SDK-BACKEND-USAGE.en.md](./CODEX-SDK-BACKEND-USAGE.en.md)
- Environment setup: [CODEX-ENV-SETUP.en.md](./CODEX-ENV-SETUP.en.md)
- Runbook: [CODEX-RUNBOOK.en.md](./CODEX-RUNBOOK.en.md)
