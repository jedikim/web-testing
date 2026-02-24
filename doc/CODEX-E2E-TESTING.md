> Language: [English](./CODEX-E2E-TESTING.en.md) | [한국어](./CODEX-E2E-TESTING.md)

# CODEX E2E TESTING

## 0. 목적

웹 자동화 코어를 외부 AI 비서 프로젝트에서 붙여 쓸 때, 사전 품질 검증을 재현 가능하게 수행한다.

## 1. 테스트 계층

1. 계약 테스트(`contract`): 시나리오 정의 품질, 중복 ID, 최소 케이스 수 검증
2. 라이브 스모크(`live smoke`): 실제 한국 사이트 접속/기본 상호작용/검증
3. assistantless loop(`chat-like simulation`): AI 비서 없이 스크린샷 공유/의사결정 루프 시뮬레이션
4. provider matrix(`llm+vision`): Gemini/OpenAI/Anthropic + YOLO26 모델 매트릭스 검증
5. evolution backend(`bug/exception growth loop`): 격리 버전 진화 + 승인 전환 검증
6. 통합 E2E(`assistant integration`): 외부 비서 프로젝트에서 webhook/메시징 연동 포함 검증

이 저장소는 1~5를 담당하고, 6은 외부 AI 비서 프로젝트에서 담당한다.

## 2. 한국 사이트 중심 스모크 시나리오

소스: `runtime/src/e2e/kr-scenarios.ts`

1. `kr_naver_home_searchbox`: 네이버 메인 접근 + 검색 입력창 확인
2. `kr_naver_search_weather`: 네이버 검색(날씨) 결과에서 질의어 유지 확인
3. `kr_daum_home_searchbox`: 다음 메인 접근 + 검색 입력창 확인
4. `kr_daum_search_news`: 다음 검색(뉴스) 결과 핵심 키워드 확인
5. `kr_naver_news_home`: 네이버 뉴스 메인 접근 + 뉴스 키워드 확인
6. `kr_naver_finance_home`: 네이버 금융 메인 접근 + 증권/금융 키워드 확인

## 2.1 Assistantless Chat-Loop 시나리오

소스: `runtime/tests/assistantless-chat-e2e.test.ts`

1. 초기 단계 LLM 분석 후 rule-first 경로로 반복
2. 실패 시 YOLO26 힌트 + revise 재시도
3. 실패 후 `not_go` 결정 시 즉시 중단
4. 캡차 의심 시 `YOLO26 감지 -> VLM 확인 -> LLM 풀이 재시도` 체인 수행
5. 멀티 사이트 전환 중 `revise/go`를 섞은 중간 인간 개입 시나리오 수행
6. 완전 자동 배치 모드에서 시나리오별 폴더(`/home/jedi/code/web-agentic-codex/testing/autonomous-batch/<run>/<scenario>/iteration-*`)에 `process.md`, `result.json`, 스크린샷 기록
7. 고복잡 목표형 시나리오 포함:
   - `autonomous_weather_family_places_from_pangyo_map_naver` (오늘 날씨 -> 서울 근교/판교역 아이 동반 장소 탐색)
   - `autonomous_weather_to_cross_site_family_route_plan` (날씨 -> 후기 탐색 -> map.naver 후보군 수집)
   - `autonomous_weekend_family_trip_multisource_planning` (기상청/VisitSeoul/서울시/지도/검색 멀티소스 13+ 단계)
   - `autonomous_public_info_transport_chain_with_captcha` (공공정보+교통 체인 + 캡차 이중 처리 13+ 단계)
   - `autonomous_budget_route_selector_drift_double_revise` (가격/후기/지도 + 이중 revise 복구 14+ 단계)

## 3. 실행 방법

사전 준비:

```bash
cd runtime
npm install
npx playwright install chromium
cp .env.example .env
```

실행:

```bash
cd runtime
npm run test:e2e:kr:contract
npm run test:e2e:kr
npm run test:e2e:kr:headful
npm run test:e2e:assistantless:contract
npm run test:e2e:assistantless:live
npm run test:e2e:autonomous:live
npm run test:provider:contract
npm run test:evolution
# 실제 키/엔드포인트가 있으면
npm run test:e2e:provider:live
```

라이브 테스트는 실행 시 `runtime/.env`를 자동으로 읽는다.
실제 브라우저 동작 점검은 `test:e2e:kr:headful` 경로를 기본으로 사용한다.
assistantless 반복 라이브 테스트는 `RUN_ASSISTANTLESS_KR_E2E=1`, `ASSISTANTLESS_KR_ITERATIONS=N`으로 제어한다.
완전 자동 배치 라이브 테스트는 `RUN_AUTONOMOUS_BATCH_E2E=1`, `AUTONOMOUS_BATCH_ITERATIONS=N`으로 제어한다.
진화 백엔드 검증은 `npm run evolution:server`로 서버 실행 후 API/SSE/UI를 통해 수동/자동 점검한다.

## 4. 결과 아티팩트

- KR 스모크 경로: `runs/samples/artifacts/e2e/YYYY-MM-DD/`
- Autonomous 배치 경로: `/home/jedi/code/web-agentic-codex/testing/autonomous-batch/<run>/`
- Autonomous 런 파일:
1. `PLANNING.md`: 인터넷 기반 시나리오 설계/플랜
2. `WORKFLOW.md`: 런 전체 워크플로우
3. `summary.md`, `summary.json`: 전체 실행 요약
4. `FINAL-OPTIMIZED-RESULT.md`: 최종 최적화 리포트
- Autonomous 시나리오 폴더 파일:
1. `iteration-*/process.md`: 단계별 과정 로그
2. `iteration-*/result.json`: 단계별 집계 출력
3. `iteration-*/step-*-before|after.png`: 단계별 스크린샷
4. `PLAN.md`, `WORKFLOW.md`, `summary.md/json`, `FINAL-OPTIMIZED-RESULT.md`

## 5. 운영 규칙

1. 라이브 테스트는 opt-in 환경에서만 실행한다(`RUN_KR_E2E=1`).
2. 로그인/결제/개인정보 입력 시나리오는 포함하지 않는다.
3. 사이트 변경으로 flaky가 발생하면 시나리오를 삭제하지 말고, selector/검증 규칙을 보수적으로 조정한다.
4. 실패가 2회 이상 반복되면 해당 시나리오를 `quarantine` 목록으로 옮기고 원인 기록을 남긴다.
5. 버그/예외가 아닌 신규 요구에 대해 evolution job을 생성하지 않는다.
