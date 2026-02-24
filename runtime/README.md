# runtime

TypeScript runtime 영역이다. `Rule-first`, `Patch-only`, `Verify-always` 원칙을 코드로 구현한다.

## 구조

- `src/types`: 공통 타입 정의
- `tests`: 런타임 테스트

## 현재 상태

- Phase 0 기준 공통 run artifact 타입을 정의했다.
- Phase 1 시작 단계로 워크플로우 검증기와 재시도 정책을 추가했다.

## 로컬 검증

```bash
cd runtime
npm install
npm test
npm run typecheck
```
