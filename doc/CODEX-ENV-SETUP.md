> Language: [English](./CODEX-ENV-SETUP.en.md) | [한국어](./CODEX-ENV-SETUP.md)

# CODEX ENV SETUP

## 0. 목적

Dual 모드 운용을 위한 환경변수 기준을 고정한다.

1. backend simple 모드 (HTTP 세션 API)
2. sdk detailed 모드 (임베딩 실행)

## 1. Git Ignore 정책

루트 `.gitignore`에 아래 패턴이 유지되어야 한다.

1. `.env`
2. `.env.*`
3. `runtime/.env`
4. `runtime/.env.*`
5. `!runtime/.env.example`
6. `testing/`

## 2. 설정 절차

1. `cp runtime/.env.example runtime/.env`
2. 키/경로 값을 채운다
3. `runtime/` 기준으로 실행해 env 로딩 일관성을 유지한다

## 3. 주요 변수 그룹

### 3.1 코어 런타임/테스트

- `PW_HEADLESS`
- `PLAYWRIGHT_TIMEOUT_MS`
- `RUN_KR_E2E`, `RUN_ASSISTANTLESS_KR_E2E`, `RUN_AUTONOMOUS_BATCH_E2E`
- `AUTONOMOUS_BATCH_ROOT`

### 3.2 Provider/모델 매트릭스

- `LLM_ENABLED`, `LLM_PROVIDER`, `LLM_MODEL`
- `GEMINI_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`
- `GEMINI_MODELS`, `OPENAI_MODELS`, `ANTHROPIC_MODELS`
- `LLM_VENDOR_ORDER`

### 3.3 YOLO26

- `YOLO26_ENABLED`
- `YOLO26_BASE_URL`
- `YOLO26_MODELS`
- `YOLO26_API_KEY` (로컬 OSS 엔드포인트면 선택)

### 3.4 Evolution backend (자가개선)

- `EVOLUTION_SERVER_HOST`, `EVOLUTION_SERVER_PORT`
- `EVOLUTION_STATE_ROOT`
- `EVOLUTION_BASE_BRANCH`, `EVOLUTION_TEST_COMMAND`
- `EVOLUTION_MAX_AUTOFIX_ATTEMPTS`, `EVOLUTION_TEST_TIMEOUT_MS`
- `EVOLUTION_CODING_MODEL` (권장 `gemini-3.1-pro-preview`)
- `EVOLUTION_AUTOMATION_MODEL` (권장 `gemini-3.0-flash`)
- `EVOLUTION_AUTOFIX_ENABLED`, `EVOLUTION_PROMOTE_MODE`

### 3.5 Backend simple 모드

- `BACKEND_SERVER_HOST`, `BACKEND_SERVER_PORT`
- `BACKEND_SESSION_ROOT`
- `BACKEND_LLM_ENABLED` (`1`: Gemini turn engine, `0`: rule-only)
- `BACKEND_AUTOMATION_MODEL` (권장 `gemini-3.0-flash`)

### 3.6 Chat automation 예제 백엔드

- `CHAT_AUTOMATION_SERVER_HOST`, `CHAT_AUTOMATION_SERVER_PORT`
- `CHAT_AUTOMATION_SESSION_ROOT`
- 실행 명령: `npm run example:chat-backend`

## 4. 권장 모델 정책

1. 코딩/패치 생성: `gemini-3.1-pro-preview`
2. 자동화 턴 추론: `gemini-3.0-flash`
3. 코딩 모델과 자동화 모델을 분리 운영

## 5. 예시 스니펫

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

### 5.2 Backend simple 모드

```bash
BACKEND_SERVER_HOST=127.0.0.1
BACKEND_SERVER_PORT=4888
BACKEND_SESSION_ROOT=/home/jedi/code/web-agentic-codex/testing/backend/state
BACKEND_LLM_ENABLED=1
BACKEND_AUTOMATION_MODEL=gemini-3.0-flash
GEMINI_API_KEY=your-key
```

### 5.3 Chat automation 예제 백엔드

```bash
CHAT_AUTOMATION_SERVER_HOST=127.0.0.1
CHAT_AUTOMATION_SERVER_PORT=4999
CHAT_AUTOMATION_SESSION_ROOT=/home/jedi/code/web-agentic-codex/testing/chat-automation/state
```

## 6. 안전 규칙

1. runtime `.env` 파일은 절대 커밋하지 않는다
2. 실전형 브라우저 검증은 `PW_HEADLESS=0`을 사용한다
3. 캡차/2FA 우회 자동화는 하지 않고 즉시 human handoff로 전환한다
4. 코딩 모델을 flash 계열로 낮추지 않는다
