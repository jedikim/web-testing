> Language: [English](./CODEX-AUTOMATION-TEST-PLAN.en.md) | [한국어](./CODEX-AUTOMATION-TEST-PLAN.md)

# CODEX AUTOMATION TEST PLAN

Last Updated: 2026-02-26 (KST)

## 0. Goal

Ship changes with practical confidence by validating:
1. deterministic correctness
2. recovery behavior
3. chat/backends operational behavior
4. live scenario robustness

## 1. Mandatory Test Order

1. Baseline quality
```bash
cd runtime
npm run typecheck
npm test
```

2. Fixture deterministic E2E
```bash
cd runtime
npm run test:e2e:fixtures
```

3. Chat UI headful E2E
```bash
cd runtime
npm run test:e2e:chat-ui:headful
```

4. KR live smoke and assistantless flows
```bash
cd runtime
npm run test:e2e:kr:headful
npm run test:e2e:assistantless:live
npm run test:e2e:autonomous:live
```

5. Provider and evolution/sdk layers
```bash
cd runtime
npm run test:provider:contract
npm run test:e2e:provider:live
npm run test:evolution
npm run test:sdk
```

## 2. Reliability Test Focus

These areas must be covered in normal regression:
1. Similo selector fingerprint recovery
2. Structure-first candidate reduction with partial vectorization
3. In-memory vector index behavior (hnsw/bruteforce fallback)
4. Cascaded LLM routing behavior
5. Plan cache reuse and degradation logic
6. Self-healing failure classification and retry behavior

Representative tests:
- `tests/auto-recovery.test.ts`
- `tests/context-reducer.test.ts`
- `tests/in-memory-vector-index.test.ts`
- `tests/session-engine-cascaded.test.ts`
- `tests/plan-cache.test.ts`
- `tests/replay-store.test.ts`
- `tests/self-healing-taxonomy.test.ts`
- `tests/retry-policy.test.ts`

## 3. Acceptance Criteria

1. baseline (`typecheck`, `npm test`) fully passes
2. headful chat UI E2E passes
3. KR/assistantless/autonomous live runs pass when enabled
4. live failures always generate evidence artifacts
5. provider live matrix runs only with configured targets; otherwise explicit skip
6. no blocker/major findings in review

## 4. Evidence Requirements

1. command list with outcomes
2. screenshot/json artifacts for live tests
3. autonomous scenario folders and per-iteration logs
4. review summary with remaining risks

## 5. Operational Notes

1. keep `PW_HEADLESS=0` for practical validation
2. do not include captcha bypass scenarios
3. quarantine flaky live scenarios with documentation instead of removing them

## 6. Danawa Scenario Hardening (2026-02-26)

The following hardening was applied and verified with live runs.
1. Hierarchy probing: prepend deterministic root/mid/detail category hints (`deterministic_hierarchy_probe`)
2. Constraint probing: inject deterministic price/color/women/hiking filter actions (`deterministic_constraint_probe`)
3. Click safety: reject over-generic LLM selectors (`span`, `div`, etc.)
4. Navigation safety: rollback on root-domain drift/promo pages/skip-link-like targets
5. Tracing safety: force model and GENERATION metadata on Langfuse `llm_call`

Latest live evidence:
- `testing/chat-ui-manual/2026-02-26T00-02-02-081Z_danawa-live/result.md`
