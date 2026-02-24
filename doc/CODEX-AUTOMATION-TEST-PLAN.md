> Language: [English](./CODEX-AUTOMATION-TEST-PLAN.en.md) | [한국어](./CODEX-AUTOMATION-TEST-PLAN.md)

# CODEX AUTOMATION TEST PLAN

최종 업데이트: 2026-02-25 (KST)

## 0. 목표

실전 신뢰도로 변경을 배포하기 위해 아래를 검증합니다:
1. 결정론 정확성
2. 복구 동작 품질
3. 채팅/백엔드 운영 동작
4. 라이브 시나리오 견고성

## 1. 필수 테스트 순서

1. 기본 품질
```bash
cd runtime
npm run typecheck
npm test
```

2. Fixture 결정론 E2E
```bash
cd runtime
npm run test:e2e:fixtures
```

3. Chat UI headful E2E
```bash
cd runtime
npm run test:e2e:chat-ui:headful
```

4. KR live smoke + assistantless
```bash
cd runtime
npm run test:e2e:kr:headful
npm run test:e2e:assistantless:live
npm run test:e2e:autonomous:live
```

5. Provider/evolution/sdk
```bash
cd runtime
npm run test:provider:contract
npm run test:e2e:provider:live
npm run test:evolution
npm run test:sdk
```

## 2. 신뢰성 회귀 핵심 범위

정기 회귀에 아래 항목이 반드시 포함되어야 합니다:
1. Similo selector fingerprint 복구
2. Cascaded LLM 라우팅 동작
3. Plan cache 재사용/품질 저하 로직
4. Self-healing 분류 및 retry 정책

대표 테스트:
- `tests/auto-recovery.test.ts`
- `tests/session-engine-cascaded.test.ts`
- `tests/plan-cache.test.ts`
- `tests/replay-store.test.ts`
- `tests/self-healing-taxonomy.test.ts`
- `tests/retry-policy.test.ts`

## 3. 합격 기준

1. 기본 검증(`typecheck`, `npm test`) 100% 통과
2. headful chat UI E2E 통과
3. KR/assistantless/autonomous live는 활성화 시 통과
4. live 실패 시 반드시 증적 아티팩트 생성
5. provider live matrix는 target 설정 시 실행, 미설정 시 명시적 skip
6. 코드 리뷰 blocker/major 0건

## 4. 증적 요구사항

1. 실행 명령과 결과 로그
2. live 테스트의 screenshot/json 증적
3. autonomous 시나리오 폴더 및 iteration 로그
4. 리뷰 요약과 잔여 리스크

## 5. 운영 노트

1. 실전 검증은 `PW_HEADLESS=0` 사용
2. 캡차 우회 시나리오 포함 금지
3. flaky live 시나리오는 삭제하지 않고 quarantine + 문서화
