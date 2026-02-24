# CODEX RUN ARTIFACTS

## 0. 목적

실행 결과를 재현 가능하게 저장하기 위한 최소 스키마와 저장 규칙을 정의한다.

## 1. 저장 위치

- 루트: `runs/`
- 샘플: `runs/samples/`
- 실운영(권장): `runs/YYYY/MM/DD/`
- 진화 상태/버전 기록: `testing/evolution/state/` (Git 제외)

## 2. 파일명 규칙

`YYYY-MM-DDTHH-mm-ssZ_<workflow_id>_<status>.json`

예시:

- `2026-02-24T09-45-00Z_shopping_search_pass.json`
- `2026-02-24T09-49-32Z_shopping_search_fail.json`

## 3. 최소 필수 필드

1. `runId`
2. `workflowId`
3. `status`
4. `startedAt`, `endedAt`, `durationMs`
5. `context`
6. `steps`
7. `failures`
8. `review`
9. `evidence`

## 4. 상태와 실패 코드

### 4.1 status

- `pass`: 검증 + 리뷰 승인
- `fail`: 테스트/검증 실패 또는 리뷰 반려
- `blocked`: human handoff 필요

### 4.2 failure code

- `SelectorNotFound`
- `ActionNotApplied`
- `ExpectationFailed`
- `VisualAmbiguity`
- `AuthBlocked`
- `ReviewRejected`
- `Unknown`

## 5. 타입 정의 참조

- TypeScript 타입: `runtime/src/types/run-artifact.ts`
- 코드 리뷰 기준: `doc/CODEX-CODE-REVIEW.md`

## 6. 샘플 데이터

- 성공 샘플: `runs/samples/2026-02-24_sample-run-pass.json`
- 실패 샘플: `runs/samples/2026-02-24_sample-run-fail.json`

## 7. 검증 명령

샘플/실행 아티팩트 구조 검증:

```bash
./scripts/validate-run-artifacts.sh
```

진화 백엔드 저장 구조 검증(수동):

1. `testing/evolution/state/jobs/<job-id>/job.json`
2. `testing/evolution/state/jobs/<job-id>/events.json`
3. `testing/evolution/state/jobs/<job-id>/scenario-pack/*`
4. `testing/evolution/state/jobs/<job-id>/attempts/*`
5. `testing/evolution/state/active-versions/<workflow-id>.json`
