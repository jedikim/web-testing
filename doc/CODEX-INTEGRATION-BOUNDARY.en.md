> Language: [English](./CODEX-INTEGRATION-BOUNDARY.en.md) | [한국어](./CODEX-INTEGRATION-BOUNDARY.md)

# CODEX INTEGRATION BOUNDARY

## 0. Purpose

Define a strict responsibility boundary between this repository and the external AI-assistant project.

## 1. This Repository Owns (Web Automation Core)

1. workflow parsing/execution (`runtime/src/workflow`, `runtime/src/engine`)
2. selector/vision fallback and patch-only recovery
3. screenshot checkpoint core runtime (`runHumanLoop`)
4. artifact schema and validation
5. assistantless E2E simulation
6. bug/exception evolution backend with approval promotion pointer

## 2. External AI-Assistant Project Owns

1. Telegram/Slack webhook and signature validation
2. message/session routing
3. assistant prompts, tool orchestration, memory
4. deployment/runtime operations (systemd/launchd/secrets/network)

## 3. Port Contract

External project must implement:
1. `DecisionPort.requestDecision(...)` -> `go/not_go/revise/unknown`
2. inject `run` and `reviseWithLlm` into `runHumanLoop(...)`
3. adapt screenshot path/question text per channel payload format

## 4. Principles

1. no hard dependency on channel SDK inside this core
2. channel replacement should not require core logic rewrite
3. sensitive actions require explicit `go`

## 5. Session/Event JSON Contracts

### 5.1 Backend Simple (`/backend/*`)

Primary read endpoints:

1. `GET /backend/sessions/:id`
2. `GET /backend/sessions/:id/stream` (SSE snapshot)
3. `GET /backend/sessions/:id/screenshot`
4. `GET /backend/sessions/:id/handoffs`

`GET /backend/sessions/:id/screenshot` example:

```json
{
  "ok": true,
  "data": {
    "path": "/tmp/backend-shot.png",
    "source": "turn_screenshot",
    "capturedAt": "2026-02-24T12:00:00.000Z",
    "turnId": "sess-...-turn-3"
  }
}
```

### 5.2 Chat Automation (`/example/chat/*`)

`GET /example/chat/sessions/:id` and SSE `snapshot` events follow this schema:

```json
{
  "schemaVersion": "chat.session.snapshot.v1",
  "emittedAt": "2026-02-24T12:00:00.000Z",
  "session": { "id": "sess-..." },
  "run": { "status": "running", "queueLength": 1 },
  "logs": [{ "id": "log-1", "level": "info", "message": "Run started" }],
  "handoffs": [
    {
      "id": "sess-...-handoff-1",
      "type": "captcha",
      "status": "waiting",
      "prompt": "Security challenge detected. Enter captcha value to continue.",
      "requestedAt": "2026-02-24T12:00:10.000Z"
    }
  ],
  "latestScreenshot": {
    "path": "/.../uploads/reference.png",
    "source": "attachment",
    "capturedAt": "2026-02-24T12:00:05.000Z"
  }
}
```

Additional endpoints:

1. `GET /example/chat/sessions/:id/handoffs`
2. `GET /example/chat/sessions/:id/screenshot`
