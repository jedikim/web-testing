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
- `src/view`: 스크린샷 우선 모드 정책
- `src/chat`: Telegram/Slack 메시지 정규화 + 스크린샷 질의 루프
- `src/integration`: 외부 AI 비서가 붙일 수 있는 중립 human-loop 인터페이스
- `src/learning`: 리플레이 저장소/카나리 게이트/룰 승격
- `src/ops`: 세션/비용·지연 지표/롤백 로그
- `tests`: 런타임 테스트

## 현재 상태

- Phase 0 기준 공통 run artifact 타입을 정의했다.
- Phase 1 시작 단계로 워크플로우 검증기와 재시도 정책을 추가했다.
- Branch/Loop를 포함한 최소 실행 경로 빌더를 추가했다.
- 결정론 실행기(`executeWorkflow`)를 추가해 고정 시나리오를 LLM 없이 실행한다.
- 기본 Extractor(`extractInputs`, `extractClickables`, `extractState`)를 추가했다.
- Controlled fallback 준비 단계로 patch-only 파이프라인 코어를 추가했다.
- Vision/Screenshot 준비 단계로 ROI 배칭, 체크포인트 정책, view mode 선택기를 추가했다.
- Chat 경로로 Telegram/Slack 입력 정규화와 screenshot question 루프를 추가했다.
- Chat과 분리된 integration 경로로 `runHumanLoop`를 추가해 외부 프로젝트가 채널 연동을 담당할 수 있게 했다.
- Self-improvement 준비 단계로 replay store와 rule promotion 게이트를 추가했다.
- Production hardening 준비 단계로 session manager, metrics dashboard, rollback log를 추가했다.
- Playwright 액션 어댑터(`src/engine/playwright-executor.ts`)를 추가했다.
- Selector auto-recovery(`src/fallback/auto-recovery.ts`)와 visual auto-recovery(`src/vision/visual-recovery.ts`)를 추가했다.
- Adaptive controller(`src/learning/adaptive-controller.ts`)와 resilience orchestrator(`src/ops/resilience-orchestrator.ts`)를 추가했다.
- `tests/phase-acceptance.test.ts`로 Phase 1~5 완료 기준을 통합 검증한다.

## 로컬 검증

```bash
cd runtime
npm install
npm test
npm run test:acceptance
npm run typecheck
```

## 환경변수

- 예시 파일: `.env.example`
- 세팅 문서: `../doc/CODEX-ENV-SETUP.md`
- 런타임 파서: `src/config/env.ts`

## 한국 사이트 E2E 스모크

- 시나리오 정의: `src/e2e/kr-scenarios.ts`
- 계약 테스트(오프라인): `tests/kr-e2e-scenarios.test.ts`
- 라이브 스모크(옵트인): `tests/e2e-kr-live.test.ts`
- 전체 플로우 시뮬레이션: `tests/automation-full-flow.test.ts`

실행:

```bash
cd runtime
npm run test:full-flow
npm run test:e2e:kr:contract
npm run test:e2e:kr
```

아티팩트:

- 스크린샷/리포트 JSON은 `runs/samples/artifacts/e2e/YYYY-MM-DD/`에 저장된다.
