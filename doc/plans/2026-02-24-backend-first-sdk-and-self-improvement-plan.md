> Language: [English](./2026-02-24-backend-first-sdk-and-self-improvement-plan.en.md) | [한국어](./2026-02-24-backend-first-sdk-and-self-improvement-plan.md)

# Backend-first SDK + Self-Improvement 보강 계획

## 0. 목표

외부 AI 비서 프로젝트가 이 저장소를 쉽게 활용할 수 있도록 사용 방식을 `Backend-first + SDK-internal`로 통일한다.

## 1. 문제 정의

현재 문제:

1. 모듈은 많지만 외부에서 바로 호출하기 쉬운 단일 SDK 진입점이 약함
2. 실행 실패와 evolution 트리거 사이 연결이 느슨함
3. 운영자가 HTTP 기준으로 제어할 자동개선 API가 부족함
4. 사용 문서가 테스트/구조 중심이고 통합 사용 시퀀스가 분산됨

## 2. 아키텍처 결정

### 권장 운영 모델

1. 외부 프로젝트는 백엔드 API만 호출
2. SDK는 백엔드 내부 orchestration 계층으로 사용
3. 실패 결과가 정책 조건을 만족할 때만 evolution 자동 트리거
4. promotion은 기본 수동 승인(정책 auto-approve는 옵션)

## 3. 구현 범위

1. `runtime/src/index.ts` 통합 export 엔트리포인트
2. `runtime/src/sdk/automation-sdk.ts` (`run`, `runWithImprovement`)
3. `runtime/src/evolution/auto-improvement-orchestrator.ts`
4. `runtime/src/sdk/evolution-api-client.ts`
5. `POST /evolution/auto-improve` API
6. `runtime/examples/*` 샘플 코드
7. `runtime/tests/*sdk*` 테스트
8. EN/KR 사용 문서 보강

## 4. 테스트 전략

1. 단위: 오케스트레이터 트리거/auto-approve 정책
2. 계약: SDK runWithImprovement 트리거 조건
3. API: evolution client/server endpoint 계약
4. 통합: 기존 evolution 테스트 + 전체 회귀

## 5. 완료 기준

1. `npm run test:sdk` 통과
2. `npm run test:evolution` 통과
3. `npm run typecheck`, `npm test` 통과
4. EN/KR 문서에서 SDK/백엔드/자동개선 절차가 한 번에 이해 가능
