> Language: [English](./CODEX-E2E-TESTING.en.md) | [한국어](./CODEX-E2E-TESTING.md)

# CODEX E2E TESTING

최종 업데이트: 2026-02-25 (KST)

## 0. 목적

실전형 E2E 검증을 재현 가능하게 수행합니다:
1. 결정론 런타임 동작 검증
2. 실패/드리프트 복구 경로 검증
3. 채팅형 자동화 운영 검증
4. provider/live 연동 준비도 검증

## 1. 테스트 계층

1. Contract 계층: 스키마/계약 검증
2. Fixture 결정론 E2E 계층
3. KR live smoke 계층
4. Assistantless live loop 계층
5. Autonomous batch 계층
6. Provider matrix 계층
7. Evolution backend/SDK 계층

## 2. 명령 맵

```bash
cd runtime
npm run test:e2e:fixtures
npm run test:e2e:kr:contract
npm run test:e2e:kr:headful
npm run test:e2e:assistantless:contract
npm run test:e2e:assistantless:live
npm run test:e2e:autonomous:live
npm run test:provider:contract
npm run test:e2e:provider:live
npm run test:evolution
npm run test:sdk
```

## 3. Live 플래그 설명

1. `RUN_KR_E2E=1`
- 한국 사이트 live smoke 시나리오 실행

2. `RUN_ASSISTANTLESS_KR_E2E=1`
- assistantless live chat-loop 시나리오 실행

3. `RUN_PROVIDER_LIVE_E2E=1`
- live provider matrix 테스트 실행
- env에 provider/model target이 설정된 경우에만 matrix 실제 실행

4. `RUN_AUTONOMOUS_BATCH_E2E=1`
- autonomous 다중 시나리오 배치 실행
- 증적은 `testing/autonomous-batch/`에 저장

5. `PW_HEADLESS=0`
- headful 브라우저 모드 (실전 검증 권장)

## 4. 핵심 시나리오 소스

1. KR live smoke: `runtime/src/e2e/kr-scenarios.ts`
2. Assistantless 시뮬레이션: `runtime/tests/assistantless-chat-e2e.test.ts`
3. Autonomous batch: `runtime/tests/e2e-autonomous-batch-kr-live.test.ts`
4. Provider live matrix: `runtime/tests/e2e-provider-live.test.ts`
5. Chat UI E2E: `runtime/tests/chat-automation-ui-e2e.test.ts`

## 5. 기대 아티팩트

KR smoke:
- `runs/samples/artifacts/e2e/YYYY-MM-DD/*.png|*.json`

Assistantless live:
- `runs/samples/artifacts/e2e-assistantless/YYYY-MM-DD/*`

Autonomous batch:
- `testing/autonomous-batch/<run>/PLANNING.md`
- `testing/autonomous-batch/<run>/WORKFLOW.md`
- `testing/autonomous-batch/<run>/summary.md`
- `testing/autonomous-batch/<run>/summary.json`
- `testing/autonomous-batch/<run>/FINAL-OPTIMIZED-RESULT.md`
- 시나리오별 iteration 폴더의 `process.md`, `result.json`, 스크린샷, `PLAN.md`, `WORKFLOW.md`

## 6. 합격/실패 정책

1. contract/fixture/unit 계층은 100% 통과 필수
2. live 실패는 반드시 screenshot/json 증적 남김
3. flaky live 케이스는 무단 삭제하지 않고 quarantine + 문서화
4. provider live matrix는 env target 미설정 시에만 skip 허용

## 7. 안전 정책

1. 기본 시나리오에서 로그인/결제/개인정보 쓰기 경로 제외
2. 캡차/2FA/보안 챌린지 자동 우회 금지
3. 보안 체크포인트는 명시적 human handoff로 처리
