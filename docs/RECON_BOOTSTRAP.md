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

3. **CLI bootstrap**
- `scripts/run_recon.py`
  - One-shot recon execution and JSON output.

4. **Compatibility fix**
- `src/__init__.py` switched to lazy exports to avoid heavy import side effects.
- Added `src/vision/visual_judge.py` lightweight fallback module used by existing v3 imports.

## Added tests

- `tests/unit/test_recon_models.py`
- `tests/unit/test_recon_litellm_router.py`
- `tests/unit/test_recon_knowledge_base.py`
- `tests/unit/test_recon_agent.py`

## Verification commands

```bash
python -m ruff check src/recon src/__init__.py src/vision/visual_judge.py scripts/run_recon.py tests/unit/test_recon_*.py
python -m pytest tests/unit/test_recon_models.py tests/unit/test_recon_litellm_router.py tests/unit/test_recon_knowledge_base.py tests/unit/test_recon_agent.py tests/unit/test_web_agent.py tests/unit/test_v3_factory.py -q
```

## Next implementation slices

1. Replace no-op scanners with Playwright/CDP-based collectors (DOM, AX tree, nav graph).
2. Add LangGraph state machine wrapper around `ReconAgent.recon`.
3. Introduce URL-pattern level bundle store (`workflows/`, `macros/`, `prompts/`).
4. Connect runtime execution logs into `runs.jsonl` with bundle/prompt versions.
