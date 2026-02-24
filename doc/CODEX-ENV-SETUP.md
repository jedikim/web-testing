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

즉 실제 키 파일은 무시하고, 예시 파일만 추적한다.

## 2. 기본 설정 절차

1. `cp runtime/.env.example runtime/.env`
2. 필요한 값만 채운다.
3. 테스트 실행 전 shell에 export 하지 않아도 `.env`를 읽는 로더(외부 프로젝트 또는 실행 스크립트)가 있으면 그 방식을 사용한다.

현재 저장소 테스트는 `process.env`를 기준으로 동작한다.  
외부 AI 비서 프로젝트에서 런타임 실행 시 `.env` 로딩 책임을 갖는다.

## 3. 주요 변수

1. `RUN_KR_E2E`: 한국 사이트 라이브 E2E 실행 여부 (`1` 또는 `0`)
2. `PW_HEADLESS`: Playwright headless 실행 (`1` 또는 `0`)
3. `PLAYWRIGHT_TIMEOUT_MS`: 기본 타임아웃(ms)
4. `HUMAN_LOOP_MAX_TURNS`: human-loop 최대 반복 수
5. `ARTIFACT_ROOT`: 아티팩트 루트 경로(기본 `runs/samples/artifacts`)
6. `LLM_ENABLED`: 코어에서 LLM 경로를 사용할지 여부 (`1` 또는 `0`)
7. `LLM_API_KEY`, `LLM_MODEL`, `LLM_BASE_URL`: LLM 연동 값

## 4. 안전 규칙

1. `LLM_ENABLED=1`이면 `LLM_API_KEY`를 반드시 설정한다.
2. 키 값은 `runtime/.env`나 OS secret store에만 저장한다.
3. `git status` 전에 `.env` 파일이 추적 대상이 아닌지 확인한다.
