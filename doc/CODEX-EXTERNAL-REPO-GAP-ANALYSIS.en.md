> Language: [English](./CODEX-EXTERNAL-REPO-GAP-ANALYSIS.en.md) | [한국어](./CODEX-EXTERNAL-REPO-GAP-ANALYSIS.md)

# External Repo Gap Analysis (web-agentic)

## 0. Scope

Compared repositories:

- Current project: `/home/jedi/code/web-agentic-codex`
- External repo: `/home/jedi/code/web-agentic-codex/temp/web-agentic` (origin: `https://github.com/jedikim/web-agentic`)

Analysis date: 2026-02-24  
Constraint: comparison/planning only, no runtime code changes

## 1. Executive Summary

1. Immediately adoptable ideas are `API contract hardening`, `session/progress event normalization`, `fixture-driven E2E structure`, and `version/diff query APIs`.
2. External repo positions like `LLM-first default` and `anti-bot stealth bypass focus` conflict with this repository’s PRD and should not be adopted.
3. For evolution isolation, this repo’s `git worktree` approach is safer and should remain the baseline.
4. Current chat backend already has practical control APIs, but can be strengthened by tighter coupling to real browser orchestration paths.

## 2. Similarities vs. Differences

| Topic | Current Project (`web-agentic-codex`) | External Repo (`web-agentic`) | Assessment |
|---|---|---|---|
| Core principle | Rule-first + Patch-only + Human-handoff | README says LLM-first, PRD says Rule-first | external docs are internally inconsistent |
| Backend runtime | Node/TS HTTP servers (`runtime/src/backend/*`) | FastAPI + SQLite (`src/api/*`) | different language, similar concepts |
| Evolution engine | bug/exception trigger + worktree isolation + approval gating | failure analysis + branch sandbox + approve/merge | keep current worktree model |
| Chat/session | multi-turn/session state/SSE/pause-resume/captcha input | session/turn/screenshot/handoff APIs | API shape is comparable; runtime implementation differs |
| Sample UIs | backend UI + chat UI example | evolution-ui + automation/sessions pages | complementary patterns |
| Model policy | gemini/openai only + single `yolo26l` | gemini-focused | keep current policy |
| Bot-evasion stance | bypass not provided by policy | stealth/human-simulation highlighted | do not adopt stealth bypass direction |

## 3. Conflict and Risk Findings

1. External README explicitly states LLM-first, while external PRD describes rule-first escalation. This is a documentation consistency risk.
2. External README test volume claims (968) do not match current test file count snapshot (about 65 files), so those figures should not be reused as-is.
3. External anti-detection/stealth orientation conflicts with this repo’s legal-safe guardrails.

## 4. Adoption Candidates (Planned Change List)

This is the requested list of files/areas to modify later. No implementation is done yet.

### A. API and Session Contract Hardening

1. `GAP-A1` Align session API payloads with standardized `detail/screenshot/handoff` fields
   - Why: improve multi-turn client consistency
   - Candidate files:
     - `runtime/src/backend/chat-automation-server.ts`
     - `runtime/src/backend/chat-automation-service.ts`
     - `runtime/src/backend/simple-backend-server.ts`
     - `runtime/src/session/types.ts`
2. `GAP-A2` Add version/history query API (`current/versions/rollback-view`)
   - Why: better operational visibility after approvals
   - Candidate files:
     - `runtime/src/evolution/server.ts`
     - `runtime/src/evolution/storage.ts`
     - `runtime/src/evolution/types.ts`
3. `GAP-A3` Add evolution job diff API
   - Why: better pre-approval code review quality
   - Candidate files:
     - `runtime/src/evolution/server.ts`
     - `runtime/src/evolution/service.ts`
     - `runtime/src/evolution/git-sandbox.ts`

### B. Runtime/Orchestration Reinforcement

4. `GAP-B1` Strengthen chat run path to execute through real Playwright orchestration (current flow is still simulation-heavy)
   - Why: closer to production-like chat-driven automation
   - Candidate files:
     - `runtime/src/backend/chat-automation-service.ts`
     - `runtime/src/engine/playwright-executor.ts`
     - `runtime/src/testing/assistantless-chat-e2e.ts`
5. `GAP-B2` Refine failure taxonomy shared by session/evolution paths
   - Why: improve automatic-fix trigger precision
   - Candidate files:
     - `runtime/src/evolution/auto-improvement-orchestrator.ts`
     - `runtime/src/evolution/scenario-growth.ts`
     - `runtime/src/types/run-artifact.ts`

### C. Testing System Improvements

6. `GAP-C1` Add deterministic HTML-fixture E2E suite
   - Why: reproducible regression checks with lower live-site dependency
   - Candidate files:
     - `runtime/tests/e2e-fixtures/*` (new)
     - `runtime/tests/*e2e*.test.ts`
7. `GAP-C2` Expand API contract tests with endpoint-level golden responses
   - Why: stronger SDK/external integration compatibility guarantees
   - Candidate files:
     - `runtime/tests/chat-automation-server.test.ts`
     - `runtime/tests/backend-simple-server.test.ts`
     - `runtime/tests/evolution-server.test.ts`
8. `GAP-C3` Add standardized progress-event schema tests
   - Why: prevent UI/assistant parser breakage
   - Candidate files:
     - `runtime/src/evolution/types.ts`
     - `runtime/src/backend/chat-automation-service.ts`
     - `runtime/tests/*stream*.test.ts`

### D. Docs and Ops Guidance

9. `GAP-D1` Extend integration-boundary docs with session/event JSON schema tables
   - Candidate files:
     - `doc/CODEX-INTEGRATION-BOUNDARY.md`
     - `doc/CODEX-INTEGRATION-BOUNDARY.en.md`
10. `GAP-D2` Add pre-approval checklist with `diff API + test logs + screenshot evidence`
    - Candidate files:
      - `doc/CODEX-EVOLUTION-BACKEND.md`
      - `doc/CODEX-EVOLUTION-BACKEND.en.md`
11. `GAP-D3` Clarify fixture E2E vs live E2E run order in the test plan
    - Candidate files:
      - `doc/CODEX-AUTOMATION-TEST-PLAN.md`
      - `doc/CODEX-AUTOMATION-TEST-PLAN.en.md`

## 5. Explicit Non-Adoption List

1. Switching default architecture to LLM-first  
   - Reason: violates this repo’s Rule-first PRD.
2. Expanding anti-bot stealth bypass features  
   - Reason: violates legal-safe and non-goal constraints.
3. Replacing worktree isolation with branch+stash sandboxing  
   - Reason: higher collision risk than current isolation model.
4. Reusing external benchmark/test-cost claims as-is  
   - Reason: current snapshot shows inconsistency risk.

## 6. Next Step (Before Coding)

1. Prioritize `GAP-A1~D3` into `P0/P1/P2`.
2. Reflect selected items into implementation/test plan docs.
3. Start implementation only after that, using the mandatory loop (Plan → Build → Test → Fix → Re-test → Review → Report).

## 7. Implementation Status (2026-02-24)

Completed:

1. `GAP-A2` version/history APIs
   - `GET /evolution/versions`
   - `GET /evolution/versions/:workflowId`
   - `GET /evolution/versions/:workflowId/current`
   - `GET /evolution/versions/:workflowId/history`
2. `GAP-A3` job diff API
   - `GET /evolution/jobs/:id/diff`
3. `GAP-A1` session contract extensions (core read APIs)
   - `GET /backend/sessions/:id/screenshot`
   - `GET /backend/sessions/:id/handoffs`
   - `GET /example/chat/sessions/:id/screenshot`
   - `GET /example/chat/sessions/:id/handoffs`
   - chat snapshot schema field added (`chat.session.snapshot.v1`)
4. `GAP-C1` deterministic fixture E2E
   - `runtime/tests/e2e-fixtures/deterministic-form.html`
   - `runtime/tests/e2e-fixture-playwright-adapter.test.ts`
5. `GAP-C2/C3` API contract/schema test reinforcement
   - expanded evolution/chat/backend server tests and SDK client tests

Remaining:

1. `GAP-B1/B2` deeper runtime orchestration integration and finer failure taxonomy
