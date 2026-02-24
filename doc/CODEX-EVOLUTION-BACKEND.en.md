> Language: [English](./CODEX-EVOLUTION-BACKEND.en.md) | [한국어](./CODEX-EVOLUTION-BACKEND.md)

# CODEX EVOLUTION BACKEND

## 0. Purpose

When bug/exception handling fails, run an isolated growth loop to produce a safer next version.

Core policy:
1. trigger only on `bug` or `exception`
2. isolate candidate in `git worktree`
3. coding model: `gemini-3.1-pro-preview`
4. automation model: flash tier (`gemini-3.0-flash`)
5. promote only after explicit user approval
6. persist every stage (events, attempts, version pointer)

## 1. Components

- `runtime/src/evolution/model-policy.ts`
- `runtime/src/evolution/storage.ts`
- `runtime/src/evolution/git-sandbox.ts`
- `runtime/src/evolution/scenario-growth.ts`
- `runtime/src/evolution/gemini-autofix.ts`
- `runtime/src/evolution/service.ts`
- `runtime/src/evolution/server.ts`
- `runtime/src/evolution/auto-improvement-orchestrator.ts`
- `runtime/evolution-ui/*`

## 2. State Machine

`draft -> sandbox_prepared -> testing -> auto_fixing -> awaiting_approval -> promoted`

Failure branches:
- `failed`
- `rejected`

## 3. Data Layout

```text
testing/evolution/state/
  jobs/<job-id>/
    job.json
    events.json
    scenario-pack/
    attempts/
  active-versions/<workflow-id>.json
  version-history/<workflow-id>.json
```

## 4. Promotion Strategy

Default mode: `pointer`

- no forced immediate merge to mainline
- update active version pointer only after approval
- optional merge mode via `EVOLUTION_PROMOTE_MODE=git-merge`

## 5. API

- `GET /health`
- `GET /evolution/jobs`
- `POST /evolution/jobs`
- `GET /evolution/jobs/:id`
- `POST /evolution/jobs/:id/retry`
- `POST /evolution/jobs/:id/approve`
- `POST /evolution/jobs/:id/reject`
- `GET /evolution/jobs/:id/events`
- `GET /evolution/jobs/:id/stream` (SSE)
- `GET /evolution/ui`
- `POST /evolution/auto-improve` (create/complete optional auto-approve from failed outcome)

## 6. Run

```bash
cd runtime
npm run evolution:server
```

## 7. Verification

```bash
cd runtime
npm run typecheck
npm run test:evolution
npm test
```
