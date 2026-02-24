> Language: [English](./CODEX-ENV-SETUP.en.md) | [한국어](./CODEX-ENV-SETUP.md)

# CODEX ENV SETUP

## 0. Purpose

Set runtime/CI environment variables consistently and keep secrets out of Git.

## 1. Git Ignore Policy

Required ignore patterns in root `.gitignore`:
1. `.env`
2. `.env.*`
3. `runtime/.env`
4. `runtime/.env.*`
5. `!runtime/.env.example`
6. `testing/`

## 2. Basic Setup

1. `cp runtime/.env.example runtime/.env`
2. fill required values
3. live tests auto-load `runtime/.env` then fallback `.env`
4. shell export may override values

## 3. Important Variables

### Core test switches
- `RUN_KR_E2E`
- `RUN_PROVIDER_LIVE_E2E`
- `RUN_ASSISTANTLESS_KR_E2E`
- `RUN_AUTONOMOUS_BATCH_E2E`
- `AUTONOMOUS_BATCH_ITERATIONS`
- `AUTONOMOUS_BATCH_ROOT`

### Playwright
- `PW_HEADLESS`
- `PLAYWRIGHT_TIMEOUT_MS`

### LLM / Provider matrix
- `LLM_ENABLED`, `LLM_PROVIDER`, `LLM_MODEL`
- `GEMINI_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`
- `GEMINI_MODELS`, `OPENAI_MODELS`, `ANTHROPIC_MODELS`
- `LLM_VENDOR_ORDER`

### YOLO26
- `YOLO26_ENABLED`
- `YOLO26_BASE_URL`
- `YOLO26_MODELS`
- `YOLO26_API_KEY` (optional for local OSS endpoint)

### Evolution backend
- `EVOLUTION_SERVER_HOST`, `EVOLUTION_SERVER_PORT`
- `EVOLUTION_STATE_ROOT`
- `EVOLUTION_BASE_BRANCH`, `EVOLUTION_TEST_COMMAND`
- `EVOLUTION_MAX_AUTOFIX_ATTEMPTS`, `EVOLUTION_TEST_TIMEOUT_MS`
- `EVOLUTION_CODING_MODEL` (default `gemini-3.1-pro-preview`)
- `EVOLUTION_AUTOMATION_MODEL` (default `gemini-3.0-flash`)
- `EVOLUTION_AUTOFIX_ENABLED`
- `EVOLUTION_PROMOTE_MODE`

## 4. Safety Rules

1. keys are mandatory when live LLM mode is enabled
2. do not commit env files
3. use headful (`PW_HEADLESS=0`) for practical validation
4. captcha chain must stay `YOLO26 -> VLM -> LLM retry -> human handoff`
5. coding model must not be flash tier

## 5. Example: Evolution Backend

```bash
EVOLUTION_SERVER_HOST=127.0.0.1
EVOLUTION_SERVER_PORT=4777
EVOLUTION_STATE_ROOT=/home/jedi/code/web-agentic-codex/testing/evolution/state
EVOLUTION_BASE_BRANCH=main
EVOLUTION_TEST_COMMAND=npm run test:automation:full
EVOLUTION_MAX_AUTOFIX_ATTEMPTS=2
EVOLUTION_TEST_TIMEOUT_MS=600000
EVOLUTION_CODING_MODEL=gemini-3.1-pro-preview
EVOLUTION_AUTOMATION_MODEL=gemini-3.0-flash
EVOLUTION_AUTOFIX_ENABLED=0
EVOLUTION_PROMOTE_MODE=pointer
```
