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
