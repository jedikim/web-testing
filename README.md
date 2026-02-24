> Language: [English](./README.md) | [한국어](./README.ko.md)

# Adaptive Web Automation Core

Rule-first web automation runtime with controlled LLM fallback, screenshot checkpoints, and bug/exception-driven evolution.

## Dual Usage Modes

1. `backend_simple`: easiest HTTP backend mode with multi-turn session APIs
2. `sdk_detailed`: embeddable SDK mode for fine-grained orchestration in your own service

```mermaid
flowchart LR
    U[Operator / External Assistant] --> B[Backend Simple API]
    B --> S[Session Store + Turn Engine]
    S --> A[Automation Runtime]
    A --> E[Evolution Backend]

    X[Internal Service Code] --> D[SDK Detailed]
    D --> S
    D --> A
```

## What This Repository Does

- deterministic workflow execution first, fallback only when needed
- multi-turn chat-like session state for automation planning/execution
- assistantless E2E simulation without implementing Slack/Telegram integration itself
- evolution backend for isolated candidate versions (worktree + test/fix + approval)

## Quick Start

```bash
cd runtime
npm install
npx playwright install chromium
cp .env.example .env
npm run typecheck
npm test
```

## Mode A: Backend Simple (HTTP + Sample UI)

Start backend:

```bash
cd runtime
npm run backend:simple:server
```

Open:

- API health: `http://127.0.0.1:4888/health`
- sample UI: `http://127.0.0.1:4888/backend/ui`

## Mode B: SDK Detailed (Embedded)

Run examples:

```bash
cd runtime
npm run example:sdk:basic
npm run example:sdk:multiturn
npm run example:sdk:auto-improve
```

## Model Policy

- coding/self-improvement loops: `gemini-3.1-pro-preview`
- automation interaction loops: `gemini-3.0-flash`

## Verification Commands

```bash
cd runtime
npm run typecheck
npm run test:sdk
npm run test:evolution
npm test
```

## Artifacts and State Paths

- runtime artifacts: `runs/samples/artifacts/`
- backend sessions: `testing/backend/state/`
- evolution state: `testing/evolution/state/`
- autonomous E2E evidence: `testing/autonomous-batch/`

## Bilingual Documentation

- Documentation index: [English](./doc/README.md) | [한국어](./doc/README.ko.md)
- SDK + Backend usage: [English](./doc/CODEX-SDK-BACKEND-USAGE.en.md) | [한국어](./doc/CODEX-SDK-BACKEND-USAGE.md)
- Environment setup: [English](./doc/CODEX-ENV-SETUP.en.md) | [한국어](./doc/CODEX-ENV-SETUP.md)
