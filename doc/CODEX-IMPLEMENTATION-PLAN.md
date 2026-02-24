# CODEX IMPLEMENTATION PLAN

## 0. 계획 원칙

이 계획은 `주차`가 아니라 `Phase`로만 관리한다.
또한 테스트 통과 후에도 코드 리뷰 승인 전에는 완료로 처리하지 않는다.

## 1. Phase 구조

### Phase 0: Foundations

목표:

1. 저장소 골격(runtime/services/recipes/runs/doc)
2. 공통 타입/로그 스키마 정의
3. 실행 아티팩트 저장 규칙 확정

완료 기준:

1. 샘플 run 1회 저장 가능
2. 실패/성공 로그 구분 저장 가능
3. run artifact 타입/저장 규칙 문서화 완료

### Phase 1: Deterministic Core

목표:

1. DSL 해석기(node/action/verify/loop/branch)
2. Playwright Executor 액션 집합 구현
3. 기본 Extractor(E_inputs/E_clickables/E_state)

완료 기준:

1. 고정 시나리오 1개 LLM 없이 재현 성공
2. 검증 실패 시 재시도 정책 동작

진행 현황(2026-02-24):

1. `runtime/src/workflow/validate-workflow.ts` 추가(노드 중복/참조 무결성 검증)
2. `runtime/src/policies/retry-policy.ts` 추가(`AuthBlocked`, `ReviewRejected` 비재시도)
3. `runtime/src/workflow/build-execution-path.ts` 추가(Branch/Loop 실행 경로 생성)
4. `runtime/src/engine/deterministic-runner.ts` 추가(DSL 노드 실행 + retry + branch/loop + handoff)
5. `runtime/src/extractor/basic-extractor.ts` 추가(E_inputs/E_clickables/E_state)
6. `runtime/src/engine/playwright-executor.ts` 추가(필수 액션 집합 실행)
7. `runtime/tests/*` 기반 단위/시나리오 테스트 통과

완료 확인(2026-02-24):

1. `runtime/tests/phase-acceptance.test.ts::phase1` 통과
2. `runtime/tests/playwright-executor.test.ts` 통과

### Phase 2: Controlled AI Fallback

목표:

1. 후보 축약 컨텍스트 생성
2. LLM Select + Patch-only 파이프라인
3. 레시피 버전업(v001→v002) 자동화

완료 기준:

1. 셀렉터 변경 케이스 자동 복구
2. 패치 적용 후 재실행 성공

진행 현황(2026-02-24):

1. `runtime/src/fallback/context-reducer.ts` 추가(후보 축약 컨텍스트 생성)
2. `runtime/src/fallback/patch-validator.ts` 추가(patch-only 검증)
3. `runtime/src/fallback/recipe-version.ts` 추가(레시피 버전업 + selector patch 적용)
4. `runtime/src/fallback/auto-recovery.ts` 추가(셀렉터 자동 복구 + 재실행)
5. `runtime/tests/context-reducer.test.ts`, `runtime/tests/patch-validator.test.ts`, `runtime/tests/recipe-version.test.ts`, `runtime/tests/auto-recovery.test.ts` 통과

완료 확인(2026-02-24):

1. `runtime/tests/phase-acceptance.test.ts::phase2` 통과

### Phase 3: Vision + Screenshot Ops

목표:

1. ROI 배칭 + 좌표 역매핑
2. 스크린샷 질의 기반 운영
3. go/not-go 체크포인트

완료 기준:

1. 시각 모호 케이스 1개 자동 복구
2. Telegram/Slack 스크린샷 질의 경로로 의사결정 가능

진행 현황(2026-02-24):

1. `runtime/src/vision/roi-batcher.ts` 추가(ROI 배칭 + 좌표 역매핑)
2. `runtime/src/checkpoint/go-no-go.ts` 추가(go/not-go 정책 평가)
3. `runtime/src/view/view-mode.ts` 추가(스크린샷 우선 모드 정책)
4. `runtime/src/vision/visual-recovery.ts` 추가(VisualAmbiguity 자동 복구)
5. `runtime/src/chat/platform-normalizer.ts`, `runtime/src/chat/screenshot-checkpoint.ts`, `runtime/src/chat/screenshot-chat-loop.ts` 추가(텔레그램/슬랙 대화형 질의)
6. `runtime/src/integration/human-loop-runtime.ts` 추가(채널 비종속 human-loop 계약)
7. `runtime/tests/roi-batcher.test.ts`, `runtime/tests/checkpoint-policy.test.ts`, `runtime/tests/view-mode.test.ts`, `runtime/tests/visual-recovery.test.ts`, `runtime/tests/chat-platform.test.ts`, `runtime/tests/screenshot-checkpoint.test.ts`, `runtime/tests/screenshot-chat-loop.test.ts`, `runtime/tests/human-loop-runtime.test.ts` 통과

완료 확인(2026-02-24):

1. `runtime/tests/phase-acceptance.test.ts::phase3` 통과
2. `runtime/tests/screenshot-chat-loop.test.ts`, `runtime/tests/human-loop-runtime.test.ts` 통과

### Phase 4: Self-Improvement

목표:

1. Python DSPy/GEPA 서비스 연동
2. 오프라인 리플레이/카나리 게이트
3. Rule Promotion 자동화

완료 기준:

1. 동일 시나리오 반복 실행에서 LLM 호출률 감소
2. 리그레션 없는 룰 승격 자동 반영

진행 현황(2026-02-24):

1. `runtime/src/learning/replay-store.ts` 추가(오프라인 리플레이 큐 저장/조회)
2. `runtime/src/learning/rule-promotion.ts` 추가(카나리 게이트 + rule version 승격)
3. `runtime/src/learning/adaptive-controller.ts` 추가(반복 실행 기반 자동 승격 반영)
4. `runtime/tests/replay-store.test.ts`, `runtime/tests/rule-promotion.test.ts`, `runtime/tests/adaptive-controller.test.ts` 통과

완료 확인(2026-02-24):

1. `runtime/tests/phase-acceptance.test.ts::phase4` 통과

### Phase 5: Production Hardening

목표:

1. 멀티 세션 운영 안정화
2. 비용/지연 대시보드
3. 롤백/감사로그/장애 대응 체계

완료 기준:

1. 복수 시나리오 안정 운영
2. 장애 시 빠른 복구 절차 확인

진행 현황(2026-02-24):

1. `runtime/src/ops/session-manager.ts` 추가(멀티 세션 동시성 제어)
2. `runtime/src/ops/metrics-dashboard.ts` 추가(비용/지연/실패율 집계)
3. `runtime/src/ops/rollback-log.ts` 추가(롤백 로그 추적)
4. `runtime/src/ops/resilience-orchestrator.ts` 추가(복수 시나리오 운영 + 복구 절차)
5. `runtime/tests/session-manager.test.ts`, `runtime/tests/metrics-dashboard.test.ts`, `runtime/tests/rollback-log.test.ts`, `runtime/tests/resilience-orchestrator.test.ts` 통과

완료 확인(2026-02-24):

1. `runtime/tests/phase-acceptance.test.ts::phase5` 통과

## 2. 작업 우선순위

```mermaid
flowchart TD
    A["Phase 0/1 완료"] --> B["Phase 2"]
    B --> C["Phase 3"]
    C --> D["Phase 4"]
    D --> E["Phase 5"]
```

선행 Phase가 완료되지 않으면 다음 Phase 기능을 본선 반영하지 않는다.

## 3. 산출물 체크리스트

각 Phase 종료 시:

1. 코드 변경
2. 문서 변경
3. 테스트 증적
4. 코드 리뷰 증적(`approve` 또는 `rework` 처리 이력)
5. Known issues
6. Rollback 지점

## 4. Code Review Gate

각 Phase는 아래 조건을 만족해야 종료 가능하다.

1. `doc/CODEX-CODE-REVIEW.md` 기준으로 리뷰 수행
2. `Blocker`/`Major` 0건
3. `Minor`/`Nit` 처리 방침 기록(즉시 수정 또는 후속 태스크)

## 5. Phase 0 Baseline Deliverables

현재 저장소 기준 Phase 0 베이스라인 산출물:

1. 디렉터리 골격: `runtime/`, `services/`, `recipes/`, `runs/`
2. 공통 타입: `runtime/src/types/run-artifact.ts`
3. 아티팩트 규칙 문서: `doc/CODEX-RUN-ARTIFACTS.md`
4. 샘플 아티팩트: `runs/samples/2026-02-24_sample-run-pass.json`, `runs/samples/2026-02-24_sample-run-fail.json`
5. 리뷰 증적: `runs/samples/2026-02-24_phase0-foundations-review.md`

## 6. Phase 1 Working Deliverables

현재 브랜치(`feature/phase1-deterministic-core`) 산출물:

1. 워크플로우 검증기: `runtime/src/workflow/validate-workflow.ts`
2. 재시도 정책: `runtime/src/policies/retry-policy.ts`
3. 실행 경로 빌더: `runtime/src/workflow/build-execution-path.ts`
4. 결정론 실행기: `runtime/src/engine/deterministic-runner.ts`
5. 기본 추출기: `runtime/src/extractor/basic-extractor.ts`
6. Fallback 코어: `runtime/src/fallback/context-reducer.ts`, `runtime/src/fallback/patch-validator.ts`, `runtime/src/fallback/recipe-version.ts`
7. Vision/Screenshot 코어: `runtime/src/vision/roi-batcher.ts`, `runtime/src/vision/visual-recovery.ts`, `runtime/src/checkpoint/go-no-go.ts`, `runtime/src/view/view-mode.ts`
8. Chat 코어: `runtime/src/chat/platform-normalizer.ts`, `runtime/src/chat/screenshot-checkpoint.ts`, `runtime/src/chat/screenshot-chat-loop.ts`
9. Integration 코어: `runtime/src/integration/human-loop-runtime.ts`
10. Learning 코어: `runtime/src/learning/replay-store.ts`, `runtime/src/learning/rule-promotion.ts`, `runtime/src/learning/adaptive-controller.ts`
11. Ops 코어: `runtime/src/ops/session-manager.ts`, `runtime/src/ops/metrics-dashboard.ts`, `runtime/src/ops/rollback-log.ts`, `runtime/src/ops/resilience-orchestrator.ts`
12. 테스트: `runtime/tests/*` 26개 파일, 총 66 테스트 통과(phase acceptance 포함)
13. 리뷰 증적: `runs/samples/2026-02-24_phase1-deterministic-core-review.md`, `runs/samples/2026-02-24_phase2-controlled-fallback-review.md`, `runs/samples/2026-02-24_phase3-screenshot-chat-review.md`, `runs/samples/2026-02-24_phase4-self-improvement-review.md`, `runs/samples/2026-02-24_phase5-production-hardening-review.md`, `runs/samples/2026-02-24_full-phase-completion-review.md`
