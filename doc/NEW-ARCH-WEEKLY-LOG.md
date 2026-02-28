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

## Week 8

- Focus
  - `GridComposer`로 다중 아이템 스크린샷을 단일 그리드 이미지로 합성
  - `LocalDetector` 인터페이스로 로컬 검출/개수 확인 경로 분리
  - `BatchVerifier`에서 VLM 1회 호출로 다중 아이템 Y/N 판단
- Code
  - `runtime/src/v3/grid-composer.ts`
  - `runtime/src/v3/local-detector.ts`
  - `runtime/src/v3/batch-verifier.ts`
  - `runtime/src/v3/index.ts`
- Tests
  - `runtime/tests/v3-batch-verifier.test.ts`
- Verification
  - `typecheck` 통과
  - `npm run test:v3` 통과 (30 passed, 1 skipped)
  - Validation target satisfied: 20개 아이템 그리드 + VLM 1회 판단 경로 검증

## Week 9

- Focus
  - `CanvasDetector`로 canvas-heavy 페이지 자동 감지
  - `CanvasExecutor`에서 로컬 검출 우선 클릭 + VLM 좌표 fallback
  - Orchestrator에 Canvas 전용 실행 경로 연결
- Code
  - `runtime/src/v3/canvas-detector.ts`
  - `runtime/src/v3/canvas-executor.ts`
  - `runtime/src/v3/orchestrator.ts` (canvas mode `auto` 통합)
  - `runtime/src/v3/index.ts`
- Tests
  - `runtime/tests/v3-canvas-path.test.ts`
- Verification
  - `typecheck` 통과
  - `npm run test:v3` 통과 (33 passed, 1 skipped)
  - Validation target satisfied: detector 성공/실패 양 경로 모두 좌표 클릭 fallback 검증

## Dependency Refresh (Post Week 9)

- Updated to latest versions
  - `vitest`: `2.1.9` -> `4.0.18`
  - `jimp`: `0.22.12` -> `1.6.0`
  - `@types/node`: `25.3.0` -> `25.3.2`
- Compatibility fixes
  - Jimp ESM import 변경 (`import { Jimp } from 'jimp'`)
  - Jimp v1 API 반영 (`cover/contain/print` object 시그니처, `write/getBuffer` async API)
- Regression verification
  - `typecheck` 통과
  - Jimp 관련 회귀 테스트 통과:
    - `tests/composite-sheet.test.ts`
  - `tests/repeated-item-judgement.test.ts`
  - `tests/assistantless-chat-e2e.test.ts`
  - `tests/v3-batch-verifier.test.ts`

## Post Week 9 Enhancement: Multi-Step + Tree Traversal

- Planner
  - 복잡 태스크에서 최소 step 수를 고정 3이 아니라 동적으로 산정(최대 9)
  - 1차 LVM 응답이 짧으면 2차 이상 확장 호출로 재분해
  - 확장 실패 시에도 결정론적 5+ step fallback 생성
- Orchestrator
  - step 실패 시 대체 후보를 트리 형태(브랜치 폭/깊이 제한)로 탐색
  - 가능한 경우 `goBack`/`gotoUrl`로 앵커 URL 복귀 후 다음 브랜치 시도
- Tests
  - `runtime/tests/v3-planner.test.ts` 확장
  - `runtime/tests/v3-tree-traversal.test.ts` 신규
