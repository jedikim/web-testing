> Language: [English](./CODEX-ENV-SETUP.en.md) | [한국어](./CODEX-ENV-SETUP.md)

# CODEX ENV SETUP

## 0. Purpose

Set runtime variables consistently for dual-mode operation:

1. backend simple mode (HTTP session API)
2. sdk detailed mode (embedded execution)

## 1. Git Ignore Policy

Required root `.gitignore` patterns:

1. `.env`
2. `.env.*`
3. `runtime/.env`
4. `runtime/.env.*`
5. `!runtime/.env.example`
6. `testing/`

## 2. Setup Steps

1. `cp runtime/.env.example runtime/.env`
2. fill required keys/paths
3. run from `runtime/` so env loading is consistent

## 3. Key Variable Groups

### 3.1 Core runtime and tests

- `PW_HEADLESS`
- `PLAYWRIGHT_TIMEOUT_MS`
- `RUN_KR_E2E`, `RUN_ASSISTANTLESS_KR_E2E`, `RUN_AUTONOMOUS_BATCH_E2E`
- `AUTONOMOUS_BATCH_ROOT`

### 3.2 Provider and model matrix

- `LLM_ENABLED`, `LLM_PROVIDER`, `LLM_MODEL`
- `GEMINI_API_KEY`, `OPENAI_API_KEY`
- `GEMINI_MODELS`, `OPENAI_MODELS`
- `LLM_VENDOR_ORDER`
  - default order: `gemini,openai`
  - default Gemini models: `gemini-3.1-pro-preview,gemini-3.0-flash`
  - default OpenAI models: `gpt-5.2-codex,gpt-5-mini`

### 3.3 YOLO26

- `YOLO26_ENABLED`
- `YOLO26_BASE_URL`
- `YOLO26_MODELS`
- `YOLO26_API_KEY` (optional for local OSS endpoint)
  - recommended model set: `yolo26l`

### 3.4 Evolution backend (self-improvement)

- `EVOLUTION_SERVER_HOST`, `EVOLUTION_SERVER_PORT`
- `EVOLUTION_STATE_ROOT`
- `EVOLUTION_BASE_BRANCH`, `EVOLUTION_TEST_COMMAND`
- `EVOLUTION_MAX_AUTOFIX_ATTEMPTS`, `EVOLUTION_TEST_TIMEOUT_MS`
- `EVOLUTION_CODING_MODEL` (recommended `gemini-3.1-pro-preview`)
- `EVOLUTION_AUTOMATION_MODEL` (recommended `gemini-3.0-flash`)
- `EVOLUTION_AUTOFIX_ENABLED`, `EVOLUTION_PROMOTE_MODE`

### 3.5 Backend simple mode

- `BACKEND_SERVER_HOST`, `BACKEND_SERVER_PORT`
- `BACKEND_SESSION_ROOT`
- `BACKEND_LLM_ENABLED` (`1` for Gemini turn engine, `0` for rule-only)
- `BACKEND_AUTOMATION_MODEL` (recommended `gemini-3.0-flash`)

### 3.6 Chat automation example backend

- `CHAT_AUTOMATION_SERVER_HOST`, `CHAT_AUTOMATION_SERVER_PORT`
- `CHAT_AUTOMATION_SESSION_ROOT`
- `CHAT_AUTOMATION_UPLOAD_ROOT`
- start command: `npm run example:chat-backend`

## 4. Recommended Model Policy

1. coding and patch generation: `gemini-3.1-pro-preview`
2. automation turn reasoning: `gemini-3.0-flash`
3. keep coding model and automation model separated

## 5. Example Snippets

### 5.1 Evolution backend

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
```

### 5.2 Backend simple mode

```bash
BACKEND_SERVER_HOST=127.0.0.1
BACKEND_SERVER_PORT=4888
BACKEND_SESSION_ROOT=/home/jedi/code/web-agentic-codex/testing/backend/state
BACKEND_LLM_ENABLED=1
BACKEND_AUTOMATION_MODEL=gemini-3.0-flash
GEMINI_API_KEY=your-key
```

### 5.3 Chat automation example backend

```bash
CHAT_AUTOMATION_SERVER_HOST=127.0.0.1
CHAT_AUTOMATION_SERVER_PORT=4999
CHAT_AUTOMATION_SESSION_ROOT=/home/jedi/code/web-agentic-codex/testing/chat-automation/state
CHAT_AUTOMATION_UPLOAD_ROOT=/home/jedi/code/web-agentic-codex/testing/chat-automation/state/uploads
```

## 6. Safety Rules

1. never commit runtime `.env` files
2. use headful (`PW_HEADLESS=0`) for practical browser validation
3. do not automate captcha/2FA bypass; stop and switch to human handoff
4. do not downgrade coding model to flash tier
