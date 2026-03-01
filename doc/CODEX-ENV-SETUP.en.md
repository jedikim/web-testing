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
- `GEMINI_MODELS` (default `gemini-3.1-pro-preview,gemini-3-flash-preview`)
- `OPENAI_MODELS` (default `gpt-5-codex,gpt-5-mini`)
- `LLM_VENDOR_ORDER` (default `gemini,openai`)
- `BACKEND_AUTOMATION_GEMINI_MODEL` (default `gemini-3-flash-preview`)
- `BACKEND_AUTOMATION_OPENAI_MODEL` (default `gpt-5-mini`)
- `EVOLUTION_CODING_MODEL` (default `gemini-3.1-pro-preview`)

### 3.3 RFDETR

- `RFDETR_ENABLED`
- `RFDETR_BASE_URL`
- `RFDETR_MODELS` (default `rf-detr-medium`)
- `RFDETR_API_KEY` (optional for local OSS endpoint)

### 3.4 Reliability and fallback controls

- `SIMILO_ENABLED`
- `BACKEND_AUTOMATION_MODEL` (default `gemini-3-flash-preview`)
- `BACKEND_CASCADE_ESCALATION_MODEL` (default `gemini-3.1-pro-preview`)
- `BACKEND_CASCADE_THRESHOLD` (default `0.65`)
- `PLAN_CACHE_ENABLED` (default `1`)
- `PLAN_CACHE_SIMILARITY_THRESHOLD` (default `0.45`)
- `CHAT_AUTOMATION_SEARCH_FALLBACK_START_ATTEMPT` (default `3`, attempt index where strict menu-traversal tasks can start search fallback)
- `CHAT_AUTOMATION_HINT_MAX_CANDIDATE_CHECKS` (default `44`, max candidate evaluations per `hint_navigate` hop)
- `CHAT_AUTOMATION_NAV_VLM_ENABLED` (default `0`, menu-candidate VLM rerank using only relevant DOM ROI snapshots)

### 3.5 Backend/chat/evolution paths

- `BACKEND_SESSION_ROOT`
- `CHAT_AUTOMATION_SESSION_ROOT`
- `CHAT_AUTOMATION_UPLOAD_ROOT`
- `CHAT_AUTOMATION_RUNTIME_SCREENSHOT_ROOT`
- `CHAT_AUTOMATION_EXECUTION_MODE` (`playwright` or `simulate`)
- `EVOLUTION_STATE_ROOT`
- `EVOLUTION_BASE_BRANCH`
- `EVOLUTION_TEST_COMMAND`

### 3.6 Langfuse tracing (optional)

- `LANGFUSE_ENABLED` (`0`/`1`)
- `LANGFUSE_PUBLIC_KEY`
- `LANGFUSE_SECRET_KEY`
- `LANGFUSE_BASE_URL`
- `LANGFUSE_ENV`
- `LANGFUSE_RELEASE`
- `LANGFUSE_TIMEOUT_SECONDS`

## 4. Recommended Policy

1. coding model: `gemini-3.1-pro-preview`
2. automation interaction model: `gemini-3-flash-preview`
3. keep headful mode for practical live validation
4. keep testing artifacts under `testing/`
5. manage prompts in `runtime/src/prompts/*` with `id@version` and log prompt tags at runtime

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
RFDETR_ENABLED=1
RFDETR_BASE_URL=http://127.0.0.1:9001
RFDETR_MODELS=rf-detr-medium
```

### 5.4 Langfuse enabled profile

```bash
LANGFUSE_ENABLED=1
LANGFUSE_PUBLIC_KEY=pk-lf-...
LANGFUSE_SECRET_KEY=sk-lf-...
LANGFUSE_BASE_URL=https://langfuse.example.com
LANGFUSE_ENV=development
LANGFUSE_RELEASE=local-dev
```

Disable:

```bash
LANGFUSE_ENABLED=0
```

## 6. Safety Rules

1. never commit runtime `.env` files
2. do not configure captcha bypass automation
3. treat security challenge steps as human handoff only

## 7. Troubleshooting (LLM 404)

1. If Langfuse spans show `http_status=404`, this is usually not a Langfuse outage; it is typically an upstream `Gemini/OpenAI endpoint/model` issue.
2. `GEMINI_BASE_URL` must point to Gemini API only. Do not set it to `LANGFUSE_BASE_URL`.
3. Recommended setup:
   - Keep `GEMINI_BASE_URL` empty (defaults to `https://generativelanguage.googleapis.com/v1beta`)
   - Use only `LANGFUSE_BASE_URL` for Langfuse host
4. Current runtime auto-detects `GEMINI_BASE_URL` pointing to a Langfuse host and falls back to the default Gemini endpoint with a warning log.
