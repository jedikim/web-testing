# AGENTS.md

## Purpose
- Build a reusable recon→codegen→runtime→self-improve web automation core.
- Keep changes practical: minimal patch, deterministic-first, verify after every action.

## Source of Truth
1. `docs/DEV_GUIDE.md`
2. `docs/RECON_CODEGEN_ARCHITECTURE.md`
3. `docs/new_arch.md`
4. `docs/ARCHITECTURE.md`
5. `README.md`

If conflicts exist: `DEV_GUIDE > RECON_CODEGEN_ARCHITECTURE > new_arch > ARCHITECTURE > README`.

## Delivery Loop
1. Plan: define scope, constraints, done criteria.
2. Build: implement smallest vertical slice.
3. Test: run unit/integration/e2e relevant to touched code.
4. Fix: patch root cause.
5. Re-test: verify no regression.
6. Document: update docs for behavior/config/usage changes.
7. Report: changed files, results, residual risks.

## Guardrails
- Do not hardcode per-site business workflows.
- Prefer DSL/structured outputs over free-form code paths.
- Keep LLM prompts/config externalized and versionable.
- For captcha/2FA/payment/security challenge, require human handoff.

## Changelog
- 2026-03-02: Added lightweight policy focused on recon/codegen architecture.
- 2026-03-02: Extended scope to real scanners + URL-pattern bundle versioning + LangGraph-ready wrapper.
- 2026-03-02: Added runtime log bridge with bundle/prompt version tracking to KB runs.jsonl.
- 2026-03-02: Added DSL-first CodeGenAgent and runtime auto-generate-on-miss path.
- 2026-03-02: Added pre-promotion validation gate for generated bundles.
- 2026-03-02: Added failure classification + self-improve planning path for runtime failures.
- 2026-03-02: Added weighted change detector and runtime change-check logging into runs history.
- 2026-03-02: Added deterministic workflow step executor stub with per-step runtime trace logs.
- 2026-03-02: Added category-driven retry/handoff recovery loop for runtime execution.
- 2026-03-02: Added deterministic replay/canary promotion gate and runtime promotion-block path.
- 2026-03-02: Added runtime strategy-stat feedback loop from KB history into codegen decision.
- 2026-03-02: Added failure-driven deterministic workflow patcher with versioned patch promotion.
