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
- `GEMINI_MODELS` (기본 `gemini-3.1-pro-preview,gemini-3-flash-preview`)
- `OPENAI_MODELS` (기본 `gpt-5-codex,gpt-5-mini`)
- `LLM_VENDOR_ORDER` (기본 `gemini,openai`)
- `BACKEND_AUTOMATION_GEMINI_MODEL` (기본 `gemini-3-flash-preview`)
- `BACKEND_AUTOMATION_OPENAI_MODEL` (기본 `gpt-5-mini`)
- `EVOLUTION_CODING_MODEL` (기본 `gemini-3.1-pro-preview`)

### 3.3 RFDETR

- `RFDETR_ENABLED`
- `RFDETR_BASE_URL`
- `RFDETR_MODELS` (기본 `rf-detr-medium`)
- `RFDETR_API_KEY` (로컬 OSS 엔드포인트면 선택)

### 3.4 신뢰성/폴백 제어

- `SIMILO_ENABLED`
- `BACKEND_AUTOMATION_MODEL` (기본 `gemini-3-flash-preview`)
- `BACKEND_CASCADE_ESCALATION_MODEL` (기본 `gemini-3.1-pro-preview`)
- `BACKEND_CASCADE_THRESHOLD` (기본 `0.65`)
- `PLAN_CACHE_ENABLED` (기본 `1`)
- `PLAN_CACHE_SIMILARITY_THRESHOLD` (기본 `0.45`)
- `CHAT_AUTOMATION_SEARCH_FALLBACK_START_ATTEMPT` (기본 `3`, strict 메뉴 트래버스 태스크에서 검색 폴백 시작 시도 번호)
- `CHAT_AUTOMATION_HINT_MAX_CANDIDATE_CHECKS` (기본 `44`, `hint_navigate` 홉당 후보 평가 상한)
- `CHAT_AUTOMATION_NAV_VLM_ENABLED` (기본 `0`, 관련 DOM ROI 스냅샷만 사용한 메뉴 후보 VLM 재정렬)

### 3.5 backend/chat/evolution 경로

- `BACKEND_SESSION_ROOT`
- `CHAT_AUTOMATION_SESSION_ROOT`
- `CHAT_AUTOMATION_UPLOAD_ROOT`
- `CHAT_AUTOMATION_RUNTIME_SCREENSHOT_ROOT`
- `CHAT_AUTOMATION_EXECUTION_MODE` (`playwright` 또는 `simulate`)
- `EVOLUTION_STATE_ROOT`
- `EVOLUTION_BASE_BRANCH`
- `EVOLUTION_TEST_COMMAND`

### 3.6 Langfuse 트레이싱 (옵션)

- `LANGFUSE_ENABLED` (`0`/`1`)
- `LANGFUSE_PUBLIC_KEY`
- `LANGFUSE_SECRET_KEY`
- `LANGFUSE_BASE_URL`
- `LANGFUSE_ENV`
- `LANGFUSE_RELEASE`
- `LANGFUSE_TIMEOUT_SECONDS`

## 4. 권장 정책

1. 코딩 모델: `gemini-3.1-pro-preview`
2. 자동화 상호작용 모델: `gemini-3-flash-preview`
3. 실전 라이브 검증은 headful 우선
4. 테스트 산출물은 `testing/` 하위에 저장
5. 프롬프트는 `runtime/src/prompts/*`에서 `id@version`으로 관리하고, 런타임 로그에 버전 태그를 기록

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
RFDETR_ENABLED=1
RFDETR_BASE_URL=http://127.0.0.1:9001
RFDETR_MODELS=rf-detr-medium
```

### 5.4 Langfuse 활성화 예시

```bash
LANGFUSE_ENABLED=1
LANGFUSE_PUBLIC_KEY=pk-lf-...
LANGFUSE_SECRET_KEY=sk-lf-...
LANGFUSE_BASE_URL=https://langfuse.example.com
LANGFUSE_ENV=development
LANGFUSE_RELEASE=local-dev
```

끄기:

```bash
LANGFUSE_ENABLED=0
```

## 6. 안전 규칙

1. runtime `.env` 파일 커밋 금지
2. 캡차 우회 자동화 설정 금지
3. 보안 챌린지는 human handoff 전용으로 처리

## 7. Troubleshooting (LLM 404)

1. Langfuse span에 `http_status=404`가 찍히면, 대개 Langfuse 문제가 아니라 `Gemini/OpenAI 호출 endpoint/model` 문제입니다.
2. `GEMINI_BASE_URL`에는 Gemini API endpoint만 넣어야 하며, `LANGFUSE_BASE_URL`을 넣으면 안 됩니다.
3. 권장값:
   - `GEMINI_BASE_URL` 비워두기 (기본값 `https://generativelanguage.googleapis.com/v1beta` 사용)
   - `LANGFUSE_BASE_URL`은 Langfuse 서버 URL만 사용
4. 최신 런타임은 `GEMINI_BASE_URL`이 Langfuse host를 가리키면 자동 경고 후 기본 Gemini endpoint로 보정합니다.
