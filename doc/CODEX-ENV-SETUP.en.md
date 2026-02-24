> Language: [English](./CODEX-ENV-SETUP.en.md) | [한국어](./CODEX-ENV-SETUP.md)

# CODEX ENV SETUP

Last Updated: 2026-02-25 (KST)

## 0. Purpose

Standardize environment configuration for:
1. runtime tests and live E2E
2. backend/chat server operation
3. evolution and SDK workflows

## 1. Git Ignore Policy

Required root `.gitignore` entries:
1. `.env`
2. `.env.*`
3. `runtime/.env`
4. `runtime/.env.*`
5. `!runtime/.env.example`
6. `testing/`
7. `temp/`

## 2. Setup Steps

1. `cp runtime/.env.example runtime/.env`
2. fill keys and paths
3. run from `runtime/` for consistent env loading

## 3. Key Variables

### 3.1 Runtime and E2E toggles

- `PW_HEADLESS`
- `PLAYWRIGHT_TIMEOUT_MS`
- `RUN_KR_E2E`
- `RUN_ASSISTANTLESS_KR_E2E`
- `RUN_PROVIDER_LIVE_E2E`
- `RUN_AUTONOMOUS_BATCH_E2E`
- `ASSISTANTLESS_KR_ITERATIONS`
- `AUTONOMOUS_BATCH_ITERATIONS`
- `AUTONOMOUS_BATCH_ROOT`

### 3.2 LLM and models

- `GEMINI_API_KEY`
- `OPENAI_API_KEY`
- `GEMINI_MODELS` (default `gemini-3.1-pro-preview,gemini-3.0-flash`)
- `OPENAI_MODELS` (default `gpt-5.2-codex,gpt-5-mini`)
- `LLM_VENDOR_ORDER` (default `gemini,openai`)

### 3.3 YOLO26

- `YOLO26_ENABLED`
- `YOLO26_BASE_URL`
- `YOLO26_MODELS` (default `yolo26l`)
- `YOLO26_API_KEY` (optional for local OSS endpoint)

### 3.4 Reliability and fallback controls

- `SIMILO_ENABLED`
- `BACKEND_AUTOMATION_MODEL` (default `gemini-3.0-flash`)
- `BACKEND_CASCADE_ESCALATION_MODEL` (default `gemini-3.1-pro-preview`)
- `BACKEND_CASCADE_THRESHOLD` (default `0.65`)
- `PLAN_CACHE_ENABLED` (default `1`)
- `PLAN_CACHE_SIMILARITY_THRESHOLD` (default `0.45`)

### 3.5 Backend/chat/evolution paths

- `BACKEND_SESSION_ROOT`
- `CHAT_AUTOMATION_SESSION_ROOT`
- `CHAT_AUTOMATION_UPLOAD_ROOT`
- `EVOLUTION_STATE_ROOT`
- `EVOLUTION_BASE_BRANCH`
- `EVOLUTION_TEST_COMMAND`

## 4. Recommended Policy

1. coding model: `gemini-3.1-pro-preview`
2. automation interaction model: `gemini-3.0-flash`
3. keep headful mode for practical live validation
4. keep testing artifacts under `testing/`

## 5. Minimal Profiles

### 5.1 Local quality profile

```bash
PW_HEADLESS=1
RUN_KR_E2E=0
RUN_ASSISTANTLESS_KR_E2E=0
RUN_PROVIDER_LIVE_E2E=0
RUN_AUTONOMOUS_BATCH_E2E=0
```

### 5.2 Headful live profile

```bash
PW_HEADLESS=0
RUN_KR_E2E=1
RUN_ASSISTANTLESS_KR_E2E=1
RUN_AUTONOMOUS_BATCH_E2E=1
AUTONOMOUS_BATCH_ROOT=/home/jedi/code/web-agentic-codex/testing/autonomous-batch
```

### 5.3 Provider live profile

```bash
RUN_PROVIDER_LIVE_E2E=1
GEMINI_API_KEY=...
OPENAI_API_KEY=...
YOLO26_ENABLED=1
YOLO26_BASE_URL=http://127.0.0.1:9001
YOLO26_MODELS=yolo26l
```

## 6. Safety Rules

1. never commit runtime `.env` files
2. do not configure captcha bypass automation
3. treat security challenge steps as human handoff only
