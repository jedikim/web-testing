# runtime

TypeScript runtime 영역이다. `Rule-first`, `Patch-only`, `Verify-always` 원칙을 코드로 구현한다.

## 구조

- `src/types`: 공통 타입 정의
- `src/workflow`: DSL 타입/검증/경로 빌더
- `src/engine`: 결정론 실행기
- `src/extractor`: 기본 추출기(E_inputs/E_clickables/E_state)
- `src/fallback`: 후보 축약/patch 검증/recipe 버전업
- `src/vision`: ROI 배칭/좌표 역매핑
- `src/checkpoint`: go/not-go 정책
- `src/live`: 라이브/스크린샷 모드 선택
- `tests`: 런타임 테스트

## 현재 상태

- Phase 0 기준 공통 run artifact 타입을 정의했다.
- Phase 1 시작 단계로 워크플로우 검증기와 재시도 정책을 추가했다.
- Branch/Loop를 포함한 최소 실행 경로 빌더를 추가했다.
- 결정론 실행기(`executeWorkflow`)를 추가해 고정 시나리오를 LLM 없이 실행한다.
- 기본 Extractor(`extractInputs`, `extractClickables`, `extractState`)를 추가했다.
- Controlled fallback 준비 단계로 patch-only 파이프라인 코어를 추가했다.
- Vision/LiveOps 준비 단계로 ROI 배칭, 체크포인트 정책, view mode 선택기를 추가했다.

## 로컬 검증

```bash
cd runtime
npm install
npm test
npm run typecheck
```
