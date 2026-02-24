# runtime

TypeScript runtime 영역이다. `Rule-first`, `Patch-only`, `Verify-always` 원칙을 코드로 구현한다.

## 구조

- `src/types`: 공통 타입 정의
- `tests`: 런타임 테스트

## 현재 상태

- Phase 0 기준 공통 run artifact 타입을 정의했다.
- 실제 실행기(`Executor`)와 검증기(`Verifier`) 구현은 Phase 1 이후에 추가한다.
