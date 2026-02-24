> Language: [English](./CODEX-RUN-ARTIFACTS.en.md) | [한국어](./CODEX-RUN-ARTIFACTS.md)

# CODEX RUN ARTIFACTS

Last Updated: 2026-02-25 (KST)

## 0. Purpose

Define schema and storage policy for reproducible run evidence.

## 1. Storage Paths

1. root: `runs/`
2. sample artifacts: `runs/samples/`
3. recommended production layout: `runs/YYYY/MM/DD/`
4. evolution state/history (gitignored): `testing/evolution/state/`

## 2. Naming Rule

`YYYY-MM-DDTHH-mm-ssZ_<workflow_id>_<status>.json`

Note: dates in examples are illustrative; use current run timestamp.

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

Reference type:
- `runtime/src/types/run-artifact.ts`

## 4. Status and Failure Codes

Status:
1. `pass`
2. `fail`
3. `blocked`

Failure code set (current):
1. `SelectorNotFound`
2. `ActionNotApplied`
3. `HiddenElement`
4. `TimingTimeout`
5. `NetworkTransient`
6. `ExpectationFailed`
7. `DataMismatch`
8. `VisualAmbiguity`
9. `RenderBlocked`
10. `RuntimeCrash`
11. `AuthBlocked`
12. `ReviewRejected`
13. `Unknown`

## 5. Validation

```bash
./scripts/validate-run-artifacts.sh
```

## 6. Evolution Evidence Checklist

1. `testing/evolution/state/jobs/<job-id>/job.json`
2. `testing/evolution/state/jobs/<job-id>/events.json`
3. `testing/evolution/state/jobs/<job-id>/scenario-pack/*`
4. `testing/evolution/state/jobs/<job-id>/attempts/*`
5. `testing/evolution/state/active-versions/<workflow-id>.json`
