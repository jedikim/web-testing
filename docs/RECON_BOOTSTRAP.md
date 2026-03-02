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

## Verification commands

```bash
python -m ruff check src/recon src/__init__.py src/vision/visual_judge.py scripts/run_recon.py tests/unit/test_recon_*.py
python -m pytest tests/unit/test_recon_*.py tests/unit/test_web_agent.py tests/unit/test_v3_factory.py -q
```

## Next implementation slices

1. Replace heuristic scanners with richer typed profile fields from `RECON_CODEGEN_ARCHITECTURE.md`.
2. Implement CodeGenAgent (DSL-first) that persists generated bundles directly into KB pattern folders.
3. Connect runtime execution logs into `runs.jsonl` with bundle/prompt versions.
4. Bind full runtime executor to DSL/macros (currently stub logging path).
5. Replace heuristic validator checks with real replay/canary execution in sandbox browser contexts.
6. Bind failure planner actions to real patch/regeneration execution paths (currently planning/logging stage).
