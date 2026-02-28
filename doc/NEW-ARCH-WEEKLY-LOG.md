[English](./NEW-ARCH-WEEKLY-LOG.en.md)

# New Architecture Weekly Log

## Week 1-2

- Focus
  - `DOM Extractor` (DOM + AX merge)
  - `TextMatcher` (exact/phrase/word/synonym/fuzzy)
  - `ElementFilter` (keyword-weight scoring + top-N)
- Code
  - `runtime/src/v3/types.ts`
  - `runtime/src/v3/dom-extractor.ts`
  - `runtime/src/v3/text-matcher.ts`
  - `runtime/src/v3/element-filter.ts`
  - `runtime/src/v3/index.ts`
- Tests
  - `runtime/tests/v3-dom-extractor.test.ts`
  - `runtime/tests/v3-text-matcher.test.ts`
  - `runtime/tests/v3-element-filter.test.ts`
  - `runtime/tests/v3-naver-shopping-keyword.test.ts`
- Verification
  - `vitest` 8 tests passed
  - Validation target satisfied: keyword `검색창` ranks a naver-shopping-like search input candidate at top

## Week 3

- Focus
  - `Actor` (candidate -> action + selector 생성 + viewport 좌표 결합)
  - `Executor` (selector 우선, 실패 시 viewport fallback)
  - `ResultVerifier` (URL > DOM > visual fallback 우선순위 검증)
- Code
  - `runtime/src/v3/actor.ts`
  - `runtime/src/v3/executor.ts`
  - `runtime/src/v3/result-verifier.ts`
  - `runtime/src/v3/types.ts` (StepPlan/Action 확장)
  - `runtime/src/v3/index.ts`
- Tests
  - `runtime/tests/v3-actor-executor-verifier.test.ts`
- Verification
  - `vitest` 13 tests passed (v3 suite)
  - Validation target satisfied: `검색창에 등산복 입력` 액션 생성/실행/검증 단위 시나리오 통과

## Week 4

- Focus
  - `Planner` screenshot-first 프롬프트/출력 계약
  - 장애물 상태(`screen_state`) + step 분해(`steps`) JSON 파서 강화
  - step마다 `keyword_weights`와 `target_viewport_xy` 강제 보강
- Code
  - `runtime/src/v3/planner.ts`
  - `runtime/src/v3/types.ts` (`ScreenState` 타입 확장)
  - `runtime/src/v3/index.ts`
- Tests
  - `runtime/tests/v3-planner.test.ts`
- Verification
  - `vitest` 17 tests passed (v3 suite)
  - Validation target satisfied: `등산복 찾기` 요청이 structured step plan으로 안정 변환됨

## Week 5

- Focus
  - `PlanCache` + `ActionCache`
  - `Orchestrator` 메인 루프(캐시 히트 우선, miss 시 extractor/filter/actor/executor/verifier 파이프라인)
  - v3 API/SDK 연결 훅 추가
- Code
  - `runtime/src/v3/cache.ts`
  - `runtime/src/v3/orchestrator.ts`
  - `runtime/src/sdk/v3-orchestration-sdk.ts`
  - `runtime/src/backend/v3-orchestrator-service.ts`
  - `runtime/src/backend/v3-orchestrator-server.ts`
  - export wiring: `runtime/src/v3/index.ts`, `runtime/src/backend/index.ts`, `runtime/src/sdk/index.ts`, `runtime/src/index.ts`
- Tests
  - `runtime/tests/v3-cache-orchestrator.test.ts`
  - `runtime/tests/v3-api-sdk.test.ts`
- Verification
  - `typecheck` 통과
  - `vitest` cache/api 통합 테스트 통과
  - Validation target satisfied: 동일 태스크 2회차에서 planner 호출 0회(누적 호출 1회 유지)

## Week 6

- Focus
  - `RetryPolicy` 추가 및 Orchestrator step 재시도 경로 통합
  - 실패 추적 정보(`attempts`, `failureReason`)를 step trace에 기록
  - KR live harness 테스트 추가 (env toggle 실행)
- Code
  - `runtime/src/v3/retry-policy.ts`
  - `runtime/src/v3/orchestrator.ts` (retry loop 통합)
  - `runtime/src/v3/index.ts`
  - `runtime/package.json` (`test:v3`, `test:v3:kr-live`)
- Tests
  - `runtime/tests/v3-retry-policy.test.ts`
  - `runtime/tests/v3-kr-live-harness.test.ts`
  - `runtime/tests/v3-cache-orchestrator.test.ts` (retry 복구 케이스 확장)
- Verification
  - `typecheck` 통과
  - `npm run test:v3` 통과 (26 passed, 1 skipped)
  - Validation target satisfied: transient 실패에서 retry로 복구되는 경로 검증

## Week 7

- Focus
  - 성공 trajectory를 Python skill 코드로 합성
  - Skill 보안 검증(금지 패턴/브라우저 API 화이트리스트)
  - Orchestrator에서 skill 재사용 경로 활성화
- Code
  - `runtime/src/v3/skill-synthesis.ts`
  - `runtime/src/v3/orchestrator.ts` (skill find/synthesize 통합)
  - `runtime/src/v3/types.ts` (`Skill` 타입)
  - `runtime/src/v3/index.ts`
- Tests
  - `runtime/tests/v3-skill-synthesis.test.ts`
  - `runtime/tests/v3-cache-orchestrator.test.ts` (skill 경로 호환)
- Verification
  - `typecheck` 통과
  - `npm run test:v3` 통과 (29 passed, 1 skipped)
  - Validation target satisfied: 2회차 동일 태스크에서 planner 대신 skill 경로 사용
