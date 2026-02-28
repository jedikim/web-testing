[한국어](./NEW-ARCH-WEEKLY-LOG.md)

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
  - `Actor` (candidate -> action + selector synthesis + viewport coordinates)
  - `Executor` (selector-first execution with viewport fallback)
  - `ResultVerifier` (URL > DOM > visual fallback validation order)
- Code
  - `runtime/src/v3/actor.ts`
  - `runtime/src/v3/executor.ts`
  - `runtime/src/v3/result-verifier.ts`
  - `runtime/src/v3/types.ts` (StepPlan/Action extensions)
  - `runtime/src/v3/index.ts`
- Tests
  - `runtime/tests/v3-actor-executor-verifier.test.ts`
- Verification
  - `vitest` 13 tests passed (v3 suite)
  - Validation target satisfied: action generation/execution/verification for `search input + type value` scenario

## Week 4

- Focus
  - Screenshot-first `Planner` prompt/response contract
  - Robust JSON parsing for `screen_state` + `steps`
  - Deterministic backfill for missing `keyword_weights` and `target_viewport_xy`
- Code
  - `runtime/src/v3/planner.ts`
  - `runtime/src/v3/types.ts` (`ScreenState` type)
  - `runtime/src/v3/index.ts`
- Tests
  - `runtime/tests/v3-planner.test.ts`
- Verification
  - `vitest` 17 tests passed (v3 suite)
  - Validation target satisfied: `find hiking wear` request is converted into structured step plans reliably

## Week 5

- Focus
  - `PlanCache` + `ActionCache`
  - Main `Orchestrator` loop (cache-hit first, full pipeline on miss)
  - Minimal v3 API/SDK integration hooks
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
  - `typecheck` passed
  - `vitest` cache/api integration tests passed
  - Validation target satisfied: second run of the same task reuses plan cache (planner call count remains 1)

## Week 6

- Focus
  - Add `RetryPolicy` and integrate step-level retry loop into Orchestrator
  - Persist retry diagnostics (`attempts`, `failureReason`) in step traces
  - Add KR live harness tests with env toggle execution
- Code
  - `runtime/src/v3/retry-policy.ts`
  - `runtime/src/v3/orchestrator.ts` (retry loop integration)
  - `runtime/src/v3/index.ts`
  - `runtime/package.json` (`test:v3`, `test:v3:kr-live`)
- Tests
  - `runtime/tests/v3-retry-policy.test.ts`
  - `runtime/tests/v3-kr-live-harness.test.ts`
  - `runtime/tests/v3-cache-orchestrator.test.ts` (retry recovery case)
- Verification
  - `typecheck` passed
  - `npm run test:v3` passed (26 passed, 1 skipped)
  - Validation target satisfied: transient failure is recovered through retry path

## Week 7

- Focus
  - Synthesize successful trajectories into Python skill code
  - Skill safety validation (blocked patterns + browser API whitelist)
  - Enable skill-first reuse path inside Orchestrator
- Code
  - `runtime/src/v3/skill-synthesis.ts`
  - `runtime/src/v3/orchestrator.ts` (skill find/synthesize integration)
  - `runtime/src/v3/types.ts` (`Skill` type)
  - `runtime/src/v3/index.ts`
- Tests
  - `runtime/tests/v3-skill-synthesis.test.ts`
  - `runtime/tests/v3-cache-orchestrator.test.ts` (skill-path compatibility)
- Verification
  - `typecheck` passed
  - `npm run test:v3` passed (29 passed, 1 skipped)
  - Validation target satisfied: second run uses skill path instead of planner for same-domain similar task

## Week 8

- Focus
  - Compose multiple item screenshots into a single grid image with `GridComposer`
  - Separate local detection/count path via `LocalDetector` interface
  - Execute one-shot multi-item Y/N judgement with `BatchVerifier` (single VLM call)
- Code
  - `runtime/src/v3/grid-composer.ts`
  - `runtime/src/v3/local-detector.ts`
  - `runtime/src/v3/batch-verifier.ts`
  - `runtime/src/v3/index.ts`
- Tests
  - `runtime/tests/v3-batch-verifier.test.ts`
- Verification
  - `typecheck` passed
  - `npm run test:v3` passed (30 passed, 1 skipped)
  - Validation target satisfied: 20-item grid judged with a single VLM call

## Week 9

- Focus
  - Auto-detect canvas-heavy pages with `CanvasDetector`
  - Use local detection first and VLM coordinate fallback in `CanvasExecutor`
  - Wire canvas-only execution path into Orchestrator (`canvasMode: auto`)
- Code
  - `runtime/src/v3/canvas-detector.ts`
  - `runtime/src/v3/canvas-executor.ts`
  - `runtime/src/v3/orchestrator.ts` (canvas mode integration)
  - `runtime/src/v3/index.ts`
- Tests
  - `runtime/tests/v3-canvas-path.test.ts`
- Verification
  - `typecheck` passed
  - `npm run test:v3` passed (33 passed, 1 skipped)
  - Validation target satisfied: both detector-success and VLM-fallback click paths are verified
