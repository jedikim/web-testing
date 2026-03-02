# Recon Bootstrap Status (v4.3)

This document tracks the first implementation slice aligned to:
- `docs/DEV_GUIDE.md`
- `docs/RECON_CODEGEN_ARCHITECTURE.md`

## Delivered in this branch

1. **Lightweight root policy**
- Added root `AGENTS.md` with concise delivery loop and source-of-truth order.

2. **Recon core package**
- `src/recon/models.py`
  - `SiteProfile` (compact domain profile)
  - `MaturityState` (`cold/warm/hot` evaluation)
- `src/recon/litellm_router.py`
  - `ModelRole` alias keys (`fast/strong/codegen/vision`)
  - Env-driven provider/model resolution (`gemini`/`openai`)
- `src/recon/knowledge_base.py`
  - Domain storage: `sites/<domain>/profile.json`, `profile.md`
  - Profile history snapshots: `profile_history/v{n}.json`
  - Run log append: `history/runs.jsonl`
- `src/recon/agent.py`
  - Async recon orchestration for DOM/visual/navigation scanners
  - Versioning on repeated recon runs
- `src/recon/scanners.py`
  - `DOMScanner`: framework/SPA/DOM+AX hash signals via Playwright+CDP
  - `VisualScanner`: repeating-pattern/content/obstacle signal extraction
  - `NavigationScanner`: nav/interaction/API hint extraction
- `src/recon/langgraph_recon.py`
  - LangGraph workflow wrapper with automatic fallback mode when dependency is absent

3. **CLI bootstrap**
- `scripts/run_recon.py`
  - One-shot recon execution with real Playwright page scan and JSON output.

4. **Compatibility fix**
- `src/__init__.py` switched to lazy exports to avoid heavy import side effects.
- Added `src/vision/visual_judge.py` lightweight fallback module used by existing v3 imports.

5. **URL-pattern bundle store**
- `KnowledgeBase.save_bundle(domain, url_pattern, bundle)` with versioned artifacts:
  - `workflows/v{n}.dsl.json`
  - `macros/v{n}/...`
  - `prompts/v{n}/*.yaml`
- `KnowledgeBase.load_current_bundle(...)` for current bundle retrieval
- `KnowledgeBase.resolve_pattern_for_url(...)` for runtime URL→pattern lookup

6. **Runtime log bridge**
- `src/recon/runtime.py`
  - Resolves URL → current bundle/pattern/version metadata
  - Appends execution records with `bundle_version` and `prompt_version` into `runs.jsonl`
  - Includes `execute_stub()` for integration wiring before full DSL executor binding

7. **CodeGenAgent (DSL-first)**
- `src/recon/codegen.py`
  - Strategy decision from profile+intent (`dom_only`, `dom_with_objdet_backup`, `objdet_dom_hybrid`, `grid_vlm`, `vlm_only`)
  - Deterministic `workflow_dsl` generation with verify-after-act steps
  - Prompt map and dependency list generation
- `ReconRuntime.execute_or_generate_stub(...)`
  - On KB miss, generates bundle with `CodeGenAgent`, stores versioned artifacts, logs `generated` run

8. **Promotion Validation Gate**
- `src/recon/validator.py`
  - `CodeValidator` + `ValidationResult`
  - Checks: DSL schema/step structure, macro syntax, replay guard, canary prompt/domain sanity
- Runtime integration:
  - `execute_or_generate_stub(..., validator=...)`
  - On failed validation, does **not** promote bundle to KB and logs `generation_failed` in runs history

9. **Failure Classification + Self-Improve Planning**
- `src/recon/failure_analyzer.py`
  - Deterministic multi-layer failure classification
  - Categories: `timing`, `selector`, `interaction`, `data`, `runtime`, `rendering`, `security`
  - Action mapping: `add_wait`, `fix_selector`, `fix_obstacle`, `change_strategy`, `full_recon`, `human_handoff`
- `src/recon/self_improver.py`
  - Converts classification into concrete remediation steps
- Runtime integration:
  - `ReconRuntime.handle_failure_stub(...)`
  - Logs `failure_category`, `recommended_action`, `requires_human` to `runs.jsonl`

10. **Change Detector + Runtime Change-Check Logging**
- `src/recon/change_detector.py`
  - 3-signal weighted detector with deterministic thresholds
  - Signals:
    - `selector_survival_rate`
    - `ax_diff_ratio`
    - `api_schema_diff_ratio`
  - Output:
    - `major_restructure`
    - `content_update`
    - unchanged
- Runtime integration:
  - `ReconRuntime.detect_change_stub(...)`
  - Appends `change_check` record in `runs.jsonl` with score/reason/signals/dead selectors

11. **Workflow Step Executor (Deterministic Stub)**
- `src/recon/runtime.py`
  - Added `StepExecutionResult`, `IWorkflowStepRunner`, `DeterministicStepRunner`
  - Added `ReconRuntime.execute_workflow_stub(...)`:
    - Resolve current bundle by URL pattern
    - Execute workflow DSL `steps` sequentially
    - Log each step as trace row (`status=step`) in `runs.jsonl`
    - On step failure: classify + remediation mapping + `failed` log
    - On success: append `executed` summary with executed step count
- This slice keeps runtime generic and site-agnostic (no domain hardcoding).

12. **Recovery Loop (Retry + Handoff Policy)**
- `src/recon/runtime.py`
  - Added `ReconRuntime.execute_with_recovery_stub(...)`
  - Deterministic policy:
    - retryable categories: `timing`, `selector`, `interaction`, `rendering`, `data`
    - immediate handoff on `security`
    - bounded retry attempts with terminal `recovery_failed`
  - Added run-log statuses:
    - `recovery_attempt`
    - `recovery_retry_scheduled`
    - `recovery_completed`
    - `recovery_handoff`
    - `recovery_failed`
- This keeps failure handling generic and category-driven (no site-specific branching).

13. **Promotion Gate (Replay/Canary Stub)**
- `src/recon/promotion_gate.py`
  - Added `PromotionGate` + `PromotionDecision`
  - Deterministic pre-promotion checks:
    - replay checks (step presence, guard limit, `verify_result` existence)
    - canary checks (domain/prompt keys/intent sanity)
  - Returns structured pass rates and issues for observability.
- Runtime integration:
  - `ReconRuntime.execute_or_generate_stub(..., promotion_gate=...)`
  - On gate failure:
    - no bundle promotion to KB
    - writes `promotion_blocked` run log with replay/canary details
    - returns `status=promotion_blocked`

14. **Strategy Feedback Loop (Runtime Stats → CodeGen)**
- `src/recon/knowledge_base.py`
  - Added `get_strategy_runtime_stats(domain, url_pattern, window)`:
    - aggregates per-strategy `runs`, `success_rate`, `avg_cost`, `p95_latency_ms`
    - reads from `history/runs.jsonl`
    - supports pattern-scoped aggregation
- `src/recon/codegen.py`
  - `CodeGenAgent.generate_bundle(..., runtime_stats=...)` added
  - Strategy selection now supports runtime-performance override when enough runs exist.
- `src/recon/runtime.py`
  - `execute_or_generate_stub` now collects runtime stats from KB and passes them to codegen
  - backward-compatible fallback for legacy codegen agents without `runtime_stats` parameter
  - runtime logs now include `strategy` field across major statuses

15. **Failure-Driven Workflow Patching**
- `src/recon/workflow_patcher.py`
  - Added deterministic `WorkflowPatcher` + `PatchDecision`
  - Category-driven patch actions:
    - `add_wait`: insert wait step before failing step
    - `fix_selector`: attach selector recovery params on failing step
    - `fix_obstacle`: inject hover pre-step
    - `change_strategy`: add strategy escalation hint
    - `human_handoff/security`: patch skipped
- `src/recon/runtime.py`
  - Added `ReconRuntime.apply_failure_patch_stub(...)`
  - Flow:
    - classify failure + remediation plan
    - apply patch deterministically
    - save as next bundle version
    - append run log (`patched` / `patch_skipped` / `patch_miss`)
- This keeps patch behavior structured and site-agnostic (no per-domain hardcoding).

16. **Version Rollback for Runtime Safety**
- `src/recon/knowledge_base.py`
  - Added `rollback_bundle(domain, url_pattern, target_version)`:
    - validates target artifacts (`workflows`, `macros`, `prompts`) exist
    - switches all `current` pointers to target version atomically in filesystem order
- `src/recon/runtime.py`
  - Added `ReconRuntime.rollback_bundle_stub(...)`
  - Logs rollback outcomes with explicit status:
    - `rolled_back`
    - `rollback_failed`
  - Includes version transition metadata in run history (`from_version`, `to_version`)
- This provides deterministic rollback path for safe operations after bad promotions/patches.

17. **Maturity State Computation and Runtime Trace**
- `src/recon/knowledge_base.py`
  - Added `get_maturity_state(domain, recent_window)`:
    - computes `total_runs`, `recent_success_rate`, `consecutive_successes`, `llm_calls_last_10`
    - derives from run-history terminal statuses (`executed/ok/recovery_completed/failed/recovery_failed`)
- `src/recon/runtime.py`
  - Added `ReconRuntime.get_maturity_state_stub(domain)`
  - Appends `maturity_check` event with computed metrics and stage (`cold/warm/hot`)
  - Returns structured maturity payload for orchestration/monitoring
- This enables low-cost health checks for automatic mode transition decisions.

18. **Auto-Rollback Guard on Consecutive Failures**
- `src/recon/knowledge_base.py`
  - Added failure-guard helpers:
    - `list_bundle_versions(domain, url_pattern)` for ordered version discovery
    - `get_consecutive_failures(domain, url_pattern, window)` for trailing failure count
- `src/recon/runtime.py`
  - Added `ReconRuntime.auto_rollback_guard_stub(...)`
  - Behavior:
    - if trailing failures < threshold → `auto_rollback_skipped` (`threshold_not_met`)
    - if no previous version available → `auto_rollback_skipped` (`no_previous_version`)
    - if rollback succeeds → `auto_rolled_back`
    - if rollback operation fails → `auto_rollback_failed`
  - All outcomes are logged with threshold/failure/version metadata.
- This adds a deterministic safety net for unstable newly promoted bundles.

19. **Domain Health Summary API**
- `src/recon/runtime.py`
  - Added `ReconRuntime.get_domain_health_summary_stub(...)`
  - Combines:
    - maturity state (`cold/warm/hot`)
    - strategy runtime stats (top strategy signal)
    - trailing consecutive failures
    - version availability for rollback
  - Computes deterministic decision hints:
    - `needs_auto_rollback`
    - `recommended_action` (`auto_rollback`, `stabilize`, `monitor_and_optimize`, `keep_hot`)
  - Appends `health_summary` event to run history for observability
- This gives a single operational snapshot API for external orchestrators.

20. **Continuous Guard Cycle**
- `src/recon/runtime.py`
  - Added `ReconRuntime.run_continuous_guard_cycle_stub(...)`
  - One-cycle control flow:
    1. collect domain health summary
    2. if rollback not needed: log `guard_cycle` with `action=no_op`
    3. if rollback needed: run auto-rollback guard and log `guard_cycle` with rollback metadata
- This forms a deterministic periodic operation primitive for backend schedulers.

21. **Persistent Health Snapshots**
- `src/recon/knowledge_base.py`
  - Added:
    - `save_health_snapshot(domain, payload)`
    - `load_latest_health_snapshot(domain)`
  - Stores snapshots at `sites/{domain}/health/latest.json` and appends `health/history.jsonl`
- `src/recon/runtime.py`
  - `get_domain_health_summary_stub(...)` now persists computed summary to KB health snapshot storage.
- This enables external assistant backends to fetch last-known health without re-running analysis each time.

22. **Executable Replay/Canary Promotion Gate**
- `src/recon/replay_runner.py`
  - Added deterministic `WorkflowReplayRunner` with typed replay cases/results/reports.
  - Runs workflow DSL steps in-memory with strict action semantics and verify-step enforcement.
- `src/recon/promotion_gate.py`
  - Upgraded gate to execute replay cases (not only static shape checks).
  - Added canary execution case in addition to domain/prompt/intent sanity checks.
  - Decision still returns structured `replay_pass_rate`, `canary_pass_rate`, and issues.
- This changes promotion from purely heuristic checks to deterministic executable validation.

23. **Adaptive Runtime Loop (Patch + Regenerate)**
- `src/recon/runtime.py`
  - Added `execute_adaptive_stub(...)` as one-shot adaptive control loop:
    1. ensure/generate bundle
    2. execute with recovery
    3. on failure: apply deterministic patch rounds
    4. if still failing: regenerate bundle rounds (with optional validator/gate)
    5. return terminal status with path metadata (`direct`, `patched`, `regenerated`, `exhausted`)
  - Added runtime events:
    - `adaptive_patch_round`
    - `adaptive_regenerated`
    - `adaptive_regeneration_blocked`
    - `adaptive_completed`
    - `adaptive_failed`
  - `execute_workflow_stub(...)` failure result now returns `verify_code` + `requires_human`.
- This binds failure handling from planning-only into deterministic execution progression.

24. **Playwright Step Runner Binding**
- `src/recon/playwright_runner.py`
  - Added `PlaywrightStepRunner` that executes DSL actions on real browser pages (sync Playwright API).
  - Supports core actions: `goto`, `capture_dom`, `extract_candidates`, `verify_result`, `click`, `type/select`, `hover`, `scroll`, `wait`.
  - Maintains browser/page lifecycle through shared runtime context.
- `src/recon/runtime.py`
  - `execute_workflow_stub(...)` now finalizes runner lifecycle via optional `close(context=...)`.
  - This allows browser-backed runners to release resources deterministically after each run.
- This advances runtime from in-memory-only execution toward browser-context execution while preserving deterministic interfaces.

25. **Browser Sandbox Canary Hook for Promotion**
- `src/recon/browser_sandbox_gate.py`
  - Added `BrowserCanaryEvaluator` + `BrowserCanaryReport`.
  - Runs lightweight browser canary on local `data:` fixture page to validate action semantics (`click/type/hover/scroll/wait/extract/verify`) without external site dependency.
  - Supports graceful `skipped` when browser runtime is unavailable.
- `src/recon/promotion_gate.py`
  - Added optional `browser_canary` integration and strict/non-strict mode.
  - In strict mode, browser canary failure blocks promotion.
  - In non-strict mode, unavailable browser canary is recorded but does not block.
- This introduces a bridge toward browser-sandbox replay/canary validation while keeping CI deterministic.

## Added tests

- `tests/unit/test_recon_models.py`
- `tests/unit/test_recon_litellm_router.py`
- `tests/unit/test_recon_knowledge_base.py`
- `tests/unit/test_recon_agent.py`
- `tests/unit/test_recon_generated_bundle.py`
- `tests/unit/test_recon_kb_bundles.py`
- `tests/unit/test_recon_scanners.py`
- `tests/unit/test_recon_langgraph.py`
- `tests/unit/test_recon_runtime.py`
- `tests/unit/test_recon_codegen.py`
- `tests/unit/test_recon_runtime_codegen_integration.py`
- `tests/unit/test_recon_validator.py`
- `tests/unit/test_recon_runtime_validator_integration.py`
- `tests/unit/test_recon_failure_analyzer.py`
- `tests/unit/test_recon_self_improver.py`
- `tests/unit/test_recon_runtime_failure_integration.py`
- `tests/unit/test_recon_change_detector.py`
- `tests/unit/test_recon_runtime_change_integration.py`
- `tests/unit/test_recon_runtime_executor_stub.py`
- `tests/unit/test_recon_runtime_recovery.py`
- `tests/unit/test_recon_promotion_gate.py`
- `tests/unit/test_recon_runtime_promotion_gate_integration.py`
- `tests/unit/test_recon_runtime_stats.py`
- `tests/unit/test_recon_codegen_runtime_stats.py`
- `tests/unit/test_recon_runtime_codegen_stats_integration.py`
- `tests/unit/test_recon_workflow_patcher.py`
- `tests/unit/test_recon_runtime_patch_integration.py`
- `tests/unit/test_recon_kb_rollback.py`
- `tests/unit/test_recon_runtime_rollback_integration.py`
- `tests/unit/test_recon_kb_maturity.py`
- `tests/unit/test_recon_runtime_maturity_integration.py`
- `tests/unit/test_recon_kb_failure_guard.py`
- `tests/unit/test_recon_runtime_auto_rollback_guard.py`
- `tests/unit/test_recon_runtime_health_summary.py`
- `tests/unit/test_recon_runtime_guard_cycle.py`
- `tests/unit/test_recon_kb_health_snapshot.py`
- `tests/unit/test_recon_runtime_health_snapshot_integration.py`
- `tests/unit/test_recon_replay_runner.py`
- `tests/unit/test_recon_runtime_adaptive_loop.py`
- `tests/unit/test_recon_playwright_runner.py`
- `tests/unit/test_recon_runtime_runner_finalize.py`
- `tests/unit/test_recon_browser_sandbox_gate.py`

## Verification commands

```bash
python -m ruff check src/recon src/__init__.py src/vision/visual_judge.py scripts/run_recon.py tests/unit/test_recon_*.py
python -m pytest tests/unit/test_recon_*.py tests/unit/test_web_agent.py tests/unit/test_v3_factory.py -q
```

## Next implementation slices

1. Replace heuristic scanners with richer typed profile fields from `RECON_CODEGEN_ARCHITECTURE.md`.
2. Implement CodeGenAgent (DSL-first) that persists generated bundles directly into KB pattern folders.
3. Connect runtime execution logs into `runs.jsonl` with bundle/prompt versions.
4. Extend Playwright step semantics (selector/text fallback, iframe/shadow support, stronger error codes) and integrate with runtime selection policy.
5. Upgrade browser canary from synthetic fixture-only to target-domain sandbox replay scenarios.
6. Expand adaptive regeneration to include strategy escalation policy + automatic rollback guard coupling.
