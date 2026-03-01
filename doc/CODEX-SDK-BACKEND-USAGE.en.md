> Language: [English](./CODEX-SDK-BACKEND-USAGE.en.md) | [한국어](./CODEX-SDK-BACKEND-USAGE.md)

# CODEX SDK + BACKEND USAGE

Last Updated: 2026-02-25 (KST)

## 0. Purpose

This document explains how to use the project in two practical ways:
1. backend-first (HTTP APIs)
2. SDK-first (embedded in your code)

Both modes share the same session and safety contracts.

## 1. Operating Modes

### 1.1 `backend_simple`

Use when you want minimal integration effort.

Start:
```bash
cd runtime
npm run backend:simple:server
```

Base URL: `http://127.0.0.1:4888`

Core endpoints:
1. `GET /health`
2. `POST /backend/sessions`
3. `POST /backend/sessions/:id/turns`
4. `GET /backend/sessions/:id/stream`
5. `GET /backend/sessions/:id/screenshot`
6. `GET /backend/sessions/:id/handoffs`

### 1.2 `chat_automation_example`

Use when you need chat-like runtime control and progress visibility.

Start:
```bash
cd runtime
npm run example:chat-backend
```

Base URL: `http://127.0.0.1:4999`

Core endpoints:
1. `POST /example/chat/sessions`
2. `POST /example/chat/sessions/:id/message`
3. `GET /example/chat/sessions/:id/stream`
4. `POST /example/chat/sessions/:id/pause`
5. `POST /example/chat/sessions/:id/resume`
6. `POST /example/chat/sessions/:id/cancel`
7. `POST /example/chat/sessions/:id/captcha`
8. `POST /example/chat/sessions/:id/handoffs/:handoffId/resolve`
9. `GET /example/chat/progress/stream`
10. `GET /example/chat/ui`

Supported message options:
- `browserMode`: `headful` or `headless`
- `autoPauseOthers`: auto-pause same-operator active run
- `attachments[]`: `url`, `path`, or `dataUrl`

### 1.3 `sdk_detailed`

Use when you need full orchestration control in application code.

Entrypoints:
1. `createWebAutomationSdk`
2. `createMultiTurnAutomationSdk`
3. `createEvolutionApiClient`

## 2. Backend Usage Examples

### 2.1 Create session (chat backend)

```bash
curl -s http://127.0.0.1:4999/example/chat/sessions \
  -H 'content-type: application/json' \
  -d '{"title":"pangyo planner","operatorId":"operator-main"}'
```

### 2.2 Send message with attachment

```bash
curl -s http://127.0.0.1:4999/example/chat/sessions/<SESSION_ID>/message \
  -H 'content-type: application/json' \
  -d '{
    "content":"Find similar shoes on Naver image search",
    "browserMode":"headful",
    "operatorId":"operator-main",
    "autoPauseOthers":true,
    "attachments":[
      {"name":"shoe.png","dataUrl":"data:image/png;base64,<BASE64>"}
    ]
  }'
```

### 2.3 Watch progress stream

```bash
curl -N http://127.0.0.1:4999/example/chat/sessions/<SESSION_ID>/stream
```

## 3. SDK Usage Example

```ts
import { createMultiTurnAutomationSdk } from '../src/index';

const sdk = createMultiTurnAutomationSdk();
const session = await sdk.createSession({ mode: 'sdk_detailed', title: 'kr-flow' });

const result = await sdk.sendUserTurn({
  sessionId: session.id,
  content: 'Use deterministic first and recover if selector drifts.'
});

console.log(result.assistantTurn.content);
```

## 4. Repeated Item Image Judgement

When many listing images repeat visually:
1. merge item images into one composite image
2. run RFDETR first
3. if uncertainty remains, run VLM on the same composite image
4. reverse-map detections to original item IDs

Modules:
1. `runtime/src/vision/composite-sheet.ts`
2. `runtime/src/vision/repeated-item-judgement.ts`

## 5. Evolution Integration

Use `createEvolutionApiClient` to control evolution jobs:
1. create/list jobs
2. inspect diffs and versions
3. approve/reject/retry
4. rollback active pointer

Evolution is triggered for bug/exception failures, not for every request.

## 6. Model Policy

1. coding/self-improvement: `gemini-3.1-pro-preview`
2. automation turns: `gemini-3-flash-preview`
3. OpenAI models: `gpt-5-codex`, `gpt-5-mini`
4. RFDETR default: `rf-detr-medium`

## 7. Safety Rules

1. no captcha/2FA bypass automation
2. human handoff for security challenges
3. keep deterministic and patch-only paths first
