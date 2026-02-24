# AGENTS.md

## 1) Purpose

이 저장소의 목표는 `Adaptive Web Automation`을 실제 구현 가능한 형태로 점진적으로 완성하는 것이다.  
핵심 원칙은 `Rule-first`, `Patch-only`, `Verify-always`, `Human-handoff`다.

## 2) Source of Truth

1. PRD:  `doc/PRD-v0.1.md`
2. 실행 프로토콜: `doc/CODEX-RUNBOOK.md`
3. 개발 계획: `doc/CODEX-IMPLEMENTATION-PLAN.md`
4. 테스트/수정: `doc/CODEX-TEST-FIX-CYCLE.md`
5. 실행 아티팩트: `doc/CODEX-RUN-ARTIFACTS.md`
6. 코드 리뷰: `doc/CODEX-CODE-REVIEW.md`
7. 태스크 템플릿: `doc/CODEX-TASK-TEMPLATE.md`
8. 외부 연동 경계: `doc/CODEX-INTEGRATION-BOUNDARY.md`
9. E2E 테스트: `doc/CODEX-E2E-TESTING.md`
10. 환경변수 설정: `doc/CODEX-ENV-SETUP.md`
11. 자동화 테스트 플랜: `doc/CODEX-AUTOMATION-TEST-PLAN.md`
12. 진화 백엔드: `doc/CODEX-EVOLUTION-BACKEND.md`
13. SDK/백엔드 사용법: `doc/CODEX-SDK-BACKEND-USAGE.md`

충돌 시 우선순위: `PRD > RUNBOOK > PLAN > SDK-BACKEND-USAGE > EVOLUTION-BACKEND > AUTOMATION-TEST-PLAN > ENV-SETUP > E2E > INTEGRATION-BOUNDARY > TEST/FIX > ARTIFACTS > REVIEW > TEMPLATE`

## 3) Multi-Agent Roles (Logical)

하나의 Codex 세션에서 역할을 논리적으로 분리해 순차 수행한다.

1. `Orchestrator`: 작업 분해, 범위/우선순위 결정, 진행 상태 관리
2. `Planner`: 워크플로우/DSL 설계, 구현 전략 산출
3. `Builder`: 코드 작성/리팩터링, 문서 동기화
4. `Verifier`: 테스트 실행, 실패 분류, 리그레션 확인
5. `Fixer`: 실패 원인별 패치, 재검증
6. `Reviewer`: 코드 리뷰 체크리스트 기반 점검, 이슈 등급화, 승인/반려
7. `Reporter`: 변경 요약, 리스크/다음 단계 보고

역할은 병렬 인격이 아니라 `명시적 단계 전환`으로 운영한다.

## 4) Mandatory Execution Loop

모든 개발 요청은 아래 루프를 따른다.

1. `Plan`: 요구사항/제약/완료 조건 정의
2. `Build`: 최소 변경으로 구현
3. `Test`: 단위/통합/시나리오 검증
4. `Fix`: 실패 원인 분류 후 패치
5. `Re-test`: 리그레션 포함 재검증
6. `Review`: 코드 리뷰 수행(이슈 등급/승인 여부 기록)
7. `Report`: 변경 파일, 결과, 남은 리스크 보고

테스트 또는 리뷰가 불가하면 이유를 명시하고, 검증 가능한 대체 체크를 수행한다.

## 5) Engineering Guardrails

1. 전체 DOM/전체 스크린샷을 상시 LLM에 보내지 않는다.
2. LLM 출력으로 코드 생성을 직접 신뢰하지 않는다. `Patch-only JSON` 우선.
3. 캡차/2FA/결제 민감 구간은 자동 우회하지 않는다.
4. 액션 직후 검증 실패 시 무한 재시도하지 않는다(재시도 한도 필수).
5. 신규 기능은 로그/메트릭 포인트를 함께 추가한다.
6. 테스트 통과만으로 완료 처리하지 않는다. 리뷰 승인까지 확인한다.
7. 기본 사용자 인터랙션은 실시간 스트리밍이 아니라 스크린샷 질의(Telegram/Slack)로 처리한다.
8. Telegram/Slack webhook/세션 라우팅/비서 프롬프트는 외부 AI 비서 프로젝트 범위이며, 이 저장소는 `assistantless e2e 시뮬레이션 + 코어 계약`까지만 구현한다.
9. 캡차는 `YOLO26 감지 → VLM 확인 → LLM 풀이/재시도` 순서로만 시도하며, 실패 시 human handoff로 중단한다.
10. 실전형 자동 배치 테스트는 `/home/jedi/code/web-agentic-codex/testing/autonomous-batch` 시나리오 폴더에 `process.md`, `result.json`, 스크린샷, `PLAN.md`, `WORKFLOW.md`, `FINAL-OPTIMIZED-RESULT.md`를 저장한다.
11. 진화(evolution) 파이프라인은 `bug/exception` 트리거에서만 시작하며 신규 요구마다 자동 실행하지 않는다.
12. 진화 candidate는 반드시 `git worktree` 격리 경로에서 테스트/수정하고, 승인 전에는 active pointer를 교체하지 않는다.
13. 문서 변경 시 `영어/한국어` 이중 문서를 유지하고, 각 문서 상단에 상호 언어 전환 링크를 제공한다.
14. 운영 모드는 `backend_simple`(HTTP)과 `sdk_detailed`(임베딩)로 구분하되, 세션 스키마/턴 기록 계약은 공통으로 유지한다.

## 6) Directory Conventions

```text
doc/                     # 제품/개발/운영 문서
runtime/                 # TS 런타임 (추후 생성)
services/                # Python 보조 서비스 (DSPy/GEPA/Vision)
recipes/                 # workflow/selectors/policies/fingerprints
runs/                    # 실행 로그/아티팩트
```

## 7) Definition of Done

1. 요구된 기능이 PRD 원칙을 위반하지 않고 동작
2. 최소 1개 이상 검증 가능한 테스트 통과
3. 실패 경로(예외/폴백) 동작 확인
4. 코드 리뷰에서 Blocker/Major 이슈가 0건
5. 변경 사항과 리스크가 문서화됨
