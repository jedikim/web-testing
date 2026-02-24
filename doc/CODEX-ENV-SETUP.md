# CODEX ENV SETUP

## 0. 목적

로컬/CI에서 동일한 방식으로 런타임 환경변수를 설정하고, 민감 정보가 Git에 포함되지 않게 한다.

## 1. Git Ignore 정책

루트 `.gitignore`에 아래 패턴이 적용되어야 한다.

1. `.env`
2. `.env.*`
3. `runtime/.env`
4. `runtime/.env.*`
5. `!runtime/.env.example`
6. `testing/`

즉 실제 키 파일은 무시하고, 예시 파일만 추적한다.

## 2. 기본 설정 절차

1. `cp runtime/.env.example runtime/.env`
2. 필요한 값만 채운다.
3. 라이브 E2E(`test:e2e:kr`, `test:e2e:provider:live`)는 실행 시 `runtime/.env`를 자동 로딩한다.
4. 필요하면 shell export로 override할 수 있다.

## 3. 주요 변수

1. `RUN_KR_E2E`: 한국 사이트 라이브 E2E 실행 여부 (`1` 또는 `0`)
2. `RUN_PROVIDER_LIVE_E2E`: 멀티 벤더 provider 라이브 E2E 실행 여부
3. `RUN_ASSISTANTLESS_KR_E2E`: assistantless KR 라이브 E2E 실행 여부
4. `ASSISTANTLESS_KR_ITERATIONS`: assistantless 반복 횟수(기본 1)
5. `RUN_AUTONOMOUS_BATCH_E2E`: 완전 자동 배치 라이브 E2E 실행 여부
6. `AUTONOMOUS_BATCH_ITERATIONS`: 완전 자동 배치 반복 횟수
7. `AUTONOMOUS_BATCH_ROOT`: 시나리오별 기록 루트 경로(기본 `/home/jedi/code/web-agentic-codex/testing/autonomous-batch`, 프로젝트 `testing/` 하위)
8. `PW_HEADLESS`: Playwright headless 실행 (`1` 또는 `0`, 실전 점검은 `0` 권장)
9. `PLAYWRIGHT_TIMEOUT_MS`: 기본 타임아웃(ms)
10. `HUMAN_LOOP_MAX_TURNS`: human-loop 최대 반복 수
11. `ARTIFACT_ROOT`: 아티팩트 루트 경로(기본 `runs/samples/artifacts`)
12. `LLM_ENABLED`: 단일 provider LLM 경로 사용 여부
13. `LLM_PROVIDER`: `openai|gemini|anthropic|openai_compatible`
14. `LLM_MODEL`, `LLM_MODEL_OPTIONS`, `LLM_BASE_URL`: 단일 provider 모델/베이스URL 설정
15. `GEMINI_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`: 회사별 키
16. `GEMINI_MODELS`, `OPENAI_MODELS`, `ANTHROPIC_MODELS`: 회사별 모델 목록(csv)
17. `LLM_VENDOR_ORDER`: 멀티 벤더 매트릭스 순서(csv)
18. `YOLO26_ENABLED`, `YOLO26_API_KEY`, `YOLO26_BASE_URL`, `YOLO26_MODELS`: YOLO26 멀티 모델 설정(오픈소스 로컬 엔드포인트는 API 키 없이 가능)
19. `EVOLUTION_SERVER_HOST`, `EVOLUTION_SERVER_PORT`: 진화 백엔드 서버 바인딩
20. `EVOLUTION_STATE_ROOT`: 진화 상태 저장 루트(기본 `testing/evolution/state`)
21. `EVOLUTION_BASE_BRANCH`, `EVOLUTION_TEST_COMMAND`: 후보 버전 생성 기준 브랜치/검증 명령
22. `EVOLUTION_MAX_AUTOFIX_ATTEMPTS`, `EVOLUTION_TEST_TIMEOUT_MS`: 자동 수정/테스트 제한
23. `EVOLUTION_CODING_MODEL`: 코딩/패치 생성 모델(기본 `gemini-3.1-pro-preview`)
24. `EVOLUTION_AUTOMATION_MODEL`: 자동화 실행 판단 모델(기본 `gemini-3.0-flash`)
25. `EVOLUTION_AUTOFIX_ENABLED`, `EVOLUTION_PROMOTE_MODE`: 자동수정 사용 및 promotion 전략

## 4. 안전 규칙

1. `LLM_ENABLED=1`이면 provider에 맞는 API 키를 반드시 설정한다.
2. `LLM_PROVIDER=openai_compatible`이면 `LLM_BASE_URL`이 필수다.
3. `RUN_PROVIDER_LIVE_E2E=1`이면 최소 1개 LLM vendor + 1개 YOLO26 target을 반드시 구성한다.
4. 키 값은 `runtime/.env`나 OS secret store에만 저장한다.
5. `git status` 전에 `.env` 파일이 추적 대상이 아닌지 확인한다.
6. headful 브라우저 검증은 `PW_HEADLESS=0`으로 실행한다.
7. 캡차 대응 정책은 `YOLO26 -> VLM -> LLM 재시도 -> human handoff` 순서를 따른다.
8. 진화 파이프라인에서 코딩 모델은 flash 계열을 사용하지 않는다.
9. 진화 상태 저장 루트는 `testing/` 하위로 두어 Git 추적에서 제외한다.

## 5. Gemini + Multi-Model 예시

```bash
LLM_ENABLED=1
LLM_PROVIDER=gemini
GEMINI_API_KEY=your-gemini-key
GEMINI_MODELS=gemini-3.0-flash,gemini-2.0-flash
LLM_MODEL=gemini-3.0-flash
```

## 6. Multi-Vendor + YOLO26 Matrix 예시

```bash
RUN_PROVIDER_LIVE_E2E=1
LLM_VENDOR_ORDER=gemini,openai,anthropic
GEMINI_API_KEY=...
GEMINI_MODELS=gemini-3.0-flash,gemini-2.0-flash
OPENAI_API_KEY=...
OPENAI_MODELS=gpt-4.1-mini,gpt-4o-mini
ANTHROPIC_API_KEY=...
ANTHROPIC_MODELS=claude-3-5-haiku-latest,claude-3-5-sonnet-latest
YOLO26_ENABLED=1
YOLO26_API_KEY=
YOLO26_BASE_URL=http://127.0.0.1:8080
YOLO26_MODELS=yolo26n,yolo26s
```

## 7. Evolution Backend 예시

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
