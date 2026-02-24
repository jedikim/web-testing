> Language: [English](./CODEX-ENV-SETUP.en.md) | [한국어](./CODEX-ENV-SETUP.md)

# CODEX ENV SETUP

최종 업데이트: 2026-02-25 (KST)

## 0. 목적

다음 실행 경로에 대한 환경설정을 표준화합니다:
1. 런타임 테스트/라이브 E2E
2. backend/chat 서버 운영
3. evolution/SDK 워크플로우

## 1. Git Ignore 정책

루트 `.gitignore` 필수 항목:
1. `.env`
2. `.env.*`
3. `runtime/.env`
4. `runtime/.env.*`
5. `!runtime/.env.example`
6. `testing/`
7. `temp/`

## 2. 설정 절차

1. `cp runtime/.env.example runtime/.env`
2. 키/경로 값 입력
3. `runtime/` 기준 실행으로 env 로딩 일관성 유지

## 3. 주요 변수

### 3.1 런타임/E2E 토글

- `PW_HEADLESS`
- `PLAYWRIGHT_TIMEOUT_MS`
- `RUN_KR_E2E`
- `RUN_ASSISTANTLESS_KR_E2E`
- `RUN_PROVIDER_LIVE_E2E`
- `RUN_AUTONOMOUS_BATCH_E2E`
- `ASSISTANTLESS_KR_ITERATIONS`
- `AUTONOMOUS_BATCH_ITERATIONS`
- `AUTONOMOUS_BATCH_ROOT`

### 3.2 LLM/모델

- `GEMINI_API_KEY`
- `OPENAI_API_KEY`
- `GEMINI_MODELS` (기본 `gemini-3.1-pro-preview,gemini-3.0-flash`)
- `OPENAI_MODELS` (기본 `gpt-5.2-codex,gpt-5-mini`)
- `LLM_VENDOR_ORDER` (기본 `gemini,openai`)

### 3.3 YOLO26

- `YOLO26_ENABLED`
- `YOLO26_BASE_URL`
- `YOLO26_MODELS` (기본 `yolo26l`)
- `YOLO26_API_KEY` (로컬 OSS 엔드포인트면 선택)

### 3.4 신뢰성/폴백 제어

- `SIMILO_ENABLED`
- `BACKEND_AUTOMATION_MODEL` (기본 `gemini-3.0-flash`)
- `BACKEND_CASCADE_ESCALATION_MODEL` (기본 `gemini-3.1-pro-preview`)
- `BACKEND_CASCADE_THRESHOLD` (기본 `0.65`)
- `PLAN_CACHE_ENABLED` (기본 `1`)
- `PLAN_CACHE_SIMILARITY_THRESHOLD` (기본 `0.45`)

### 3.5 backend/chat/evolution 경로

- `BACKEND_SESSION_ROOT`
- `CHAT_AUTOMATION_SESSION_ROOT`
- `CHAT_AUTOMATION_UPLOAD_ROOT`
- `EVOLUTION_STATE_ROOT`
- `EVOLUTION_BASE_BRANCH`
- `EVOLUTION_TEST_COMMAND`

## 4. 권장 정책

1. 코딩 모델: `gemini-3.1-pro-preview`
2. 자동화 상호작용 모델: `gemini-3.0-flash`
3. 실전 라이브 검증은 headful 우선
4. 테스트 산출물은 `testing/` 하위에 저장

## 5. 최소 프로파일 예시

### 5.1 로컬 품질 검증용

```bash
PW_HEADLESS=1
RUN_KR_E2E=0
RUN_ASSISTANTLESS_KR_E2E=0
RUN_PROVIDER_LIVE_E2E=0
RUN_AUTONOMOUS_BATCH_E2E=0
```

### 5.2 headful 라이브 검증용

```bash
PW_HEADLESS=0
RUN_KR_E2E=1
RUN_ASSISTANTLESS_KR_E2E=1
RUN_AUTONOMOUS_BATCH_E2E=1
AUTONOMOUS_BATCH_ROOT=/home/jedi/code/web-agentic-codex/testing/autonomous-batch
```

### 5.3 provider live 검증용

```bash
RUN_PROVIDER_LIVE_E2E=1
GEMINI_API_KEY=...
OPENAI_API_KEY=...
YOLO26_ENABLED=1
YOLO26_BASE_URL=http://127.0.0.1:9001
YOLO26_MODELS=yolo26l
```

## 6. 안전 규칙

1. runtime `.env` 파일 커밋 금지
2. 캡차 우회 자동화 설정 금지
3. 보안 챌린지는 human handoff 전용으로 처리
