> Language: [English](./CODEX-RUN-ARTIFACTS.en.md) | [한국어](./CODEX-RUN-ARTIFACTS.md)

# CODEX RUN ARTIFACTS

최종 업데이트: 2026-02-25 (KST)

## 0. 목적

실행 증적을 재현 가능하게 저장하기 위한 스키마/경로 규칙을 정의합니다.

## 1. 저장 경로

1. 루트: `runs/`
2. 샘플: `runs/samples/`
3. 실운영 권장 구조: `runs/YYYY/MM/DD/`
4. 진화 상태/이력(깃 제외): `testing/evolution/state/`

## 2. 파일명 규칙

`YYYY-MM-DDTHH-mm-ssZ_<workflow_id>_<status>.json`

참고: 예시 날짜는 설명용이며 실제 실행 시점 타임스탬프를 사용합니다.

## 3. 필수 필드

1. `runId`
2. `workflowId`
3. `status`
4. `startedAt`, `endedAt`, `durationMs`
5. `context`
6. `steps`
7. `failures`
8. `review`
9. `evidence`

타입 정의:
- `runtime/src/types/run-artifact.ts`

## 4. 상태/실패 코드

status:
1. `pass`
2. `fail`
3. `blocked`

현재 failure code 세트:
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

## 5. 검증

```bash
./scripts/validate-run-artifacts.sh
```

## 6. Evolution 증적 체크리스트

1. `testing/evolution/state/jobs/<job-id>/job.json`
2. `testing/evolution/state/jobs/<job-id>/events.json`
3. `testing/evolution/state/jobs/<job-id>/scenario-pack/*`
4. `testing/evolution/state/jobs/<job-id>/attempts/*`
5. `testing/evolution/state/active-versions/<workflow-id>.json`
