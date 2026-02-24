> Language: [English](./CODEX-RUN-ARTIFACTS.en.md) | [한국어](./CODEX-RUN-ARTIFACTS.md)

# CODEX RUN ARTIFACTS

## 0. Purpose

Define minimal schema and path policy for reproducible run evidence.

## 1. Storage Paths

- root: `runs/`
- samples: `runs/samples/`
- recommended production: `runs/YYYY/MM/DD/`
- evolution state/history (git-ignored): `testing/evolution/state/`

## 2. Naming Rule

`YYYY-MM-DDTHH-mm-ssZ_<workflow_id>_<status>.json`

## 3. Required Fields

1. `runId`
2. `workflowId`
3. `status`
4. `startedAt`, `endedAt`, `durationMs`
5. `context`
6. `steps`
7. `failures`
8. `review`
9. `evidence`

## 4. Status and Failure Codes

Status: `pass`, `fail`, `blocked`

Failure examples:
- `SelectorNotFound`
- `ActionNotApplied`
- `ExpectationFailed`
- `VisualAmbiguity`
- `AuthBlocked`
- `ReviewRejected`
- `Unknown`

## 5. Validation

```bash
./scripts/validate-run-artifacts.sh
```

Evolution evidence checklist:
1. `jobs/<job-id>/job.json`
2. `jobs/<job-id>/events.json`
3. `jobs/<job-id>/scenario-pack/*`
4. `jobs/<job-id>/attempts/*`
5. `active-versions/<workflow-id>.json`
