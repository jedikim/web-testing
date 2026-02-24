> Language: [English](./README.md) | [한국어](./README.ko.md)

# Adaptive Web Automation Core

Last Updated: 2026-02-25 (KST)

This repository provides the web-automation core for an external AI assistant project.
It is designed for:
1. deterministic-first web execution
2. bounded LLM fallback
3. screenshot-based human handoff for sensitive steps
4. bug/exception-driven self-improvement (not per every new request)

Legal-safe default:
- no automatic captcha/2FA/security bypass
- immediate handoff to human input on security challenges

## Scope Boundary

In scope:
- web automation runtime, session contracts, fallback/recovery, E2E simulation
- chat-style backend sample and SDK for embedding

Out of scope:
- production Slack/Telegram bot routing and webhook orchestration
- credential vault/policy management for production assistants

## Core Capabilities

1. Deterministic workflow engine (`rules first`)
2. Selector recovery with Similo-style fingerprints before LLM patch fallback
3. Cascaded LLM routing (`flash-first -> uncertainty/sensitive gate -> pro -> rule fallback`)
4. Semantic replay + plan cache reuse/adaptation for repeated tasks
5. Self-healing taxonomy for failure classification and suggested action
6. Repeated-item visual chain (`composite image -> YOLO26 -> VLM fallback -> reverse mapping`)
7. Chat automation backend sample with:
   - headful/headless switch
   - live logs/progress stream (SSE)
   - pause/resume/cancel
   - captcha handoff input
   - image attachments
8. Evolution backend for isolated candidate versions (`git worktree`) and approval-based promotion

## Architecture

```mermaid
flowchart LR
    U[Operator / External Assistant] --> C[Chat or Backend API]
    C --> S[Session Store]
    C --> T[Turn Engine]
    T --> D[Deterministic Runtime]
    D --> F[Fallback and Recovery]
    F --> H[Human Handoff]
    D --> E[Evolution Trigger on Bug/Exception]
    E --> W[Worktree Candidate + Test/Fix Loop]
```

## Quick Start

```bash
cd runtime
npm install
npx playwright install chromium
cp .env.example .env
npm run typecheck
npm test
```

## How to Run

### Mode A: Backend Simple

```bash
cd runtime
npm run backend:simple:server
```

- Health: `http://127.0.0.1:4888/health`
- UI sample: `http://127.0.0.1:4888/backend/ui`

### Mode B: Chat Automation Example Backend

```bash
cd runtime
npm run example:chat-backend
```

- Health: `http://127.0.0.1:4999/example/chat/health`
- Chat UI: `http://127.0.0.1:4999/example/chat/ui`

### Mode C: SDK Embedded Usage

```bash
cd runtime
npm run example:sdk:basic
npm run example:sdk:multiturn
npm run example:sdk:auto-improve
npm run example:sdk:human-handoff
npm run example:repeated-item
```

## Environment Essentials

- LLM providers supported: `gemini`, `openai` only
- Default Gemini models: `gemini-3.1-pro-preview,gemini-3.0-flash`
- Default OpenAI models: `gpt-5.2-codex,gpt-5-mini`
- YOLO26 default model: `yolo26l`

Key variables:
- `BACKEND_AUTOMATION_MODEL`
- `BACKEND_CASCADE_ESCALATION_MODEL`
- `BACKEND_CASCADE_THRESHOLD`
- `PLAN_CACHE_ENABLED`
- `PLAN_CACHE_SIMILARITY_THRESHOLD`
- `SIMILO_ENABLED`

Full setup:
- [Environment Setup (EN)](./doc/CODEX-ENV-SETUP.en.md)
- [환경설정 (KO)](./doc/CODEX-ENV-SETUP.md)

## E2E Test Entry

Main command groups:

```bash
cd runtime
npm run typecheck
npm test
npm run test:e2e:chat-ui:headful
npm run test:e2e:kr:headful
npm run test:e2e:assistantless:live
npm run test:e2e:provider:live
npm run test:e2e:autonomous:live
```

Meaning of live flags:
1. `RUN_KR_E2E=1`: run Korea live smoke scenarios
2. `RUN_ASSISTANTLESS_KR_E2E=1`: run assistantless live loop scenarios
3. `RUN_PROVIDER_LIVE_E2E=1`: run real provider matrix (if model targets are configured)
4. `RUN_AUTONOMOUS_BATCH_E2E=1`: run autonomous batch scenarios and save evidence under `testing/autonomous-batch/`

## Documentation Map

Start here:
1. [Documentation Index (EN)](./doc/README.md)
2. [문서 인덱스 (KO)](./doc/README.ko.md)

Most-used docs:
1. [Runbook (EN)](./doc/CODEX-RUNBOOK.en.md) | [런북 (KO)](./doc/CODEX-RUNBOOK.md)
2. [Automation Test Plan (EN)](./doc/CODEX-AUTOMATION-TEST-PLAN.en.md) | [자동화 테스트 계획 (KO)](./doc/CODEX-AUTOMATION-TEST-PLAN.md)
3. [E2E Testing Guide (EN)](./doc/CODEX-E2E-TESTING.en.md) | [E2E 테스트 가이드 (KO)](./doc/CODEX-E2E-TESTING.md)
4. [SDK + Backend Usage (EN)](./doc/CODEX-SDK-BACKEND-USAGE.en.md) | [SDK + 백엔드 사용법 (KO)](./doc/CODEX-SDK-BACKEND-USAGE.md)
