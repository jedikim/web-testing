# CODEX AUTOMATION TEST PLAN

## 0. 목표

웹 자동화 코어를 "실제 운영 전"에 단계적으로 검증한다.

핵심은 아래 3가지를 동시에 만족하는 것이다.

1. 결정론 실행 경로가 안정적으로 동작
2. 실패 복구(selector/vision/human-loop) 경로가 재현 가능
3. 한국 사이트 기준 라이브 스모크에서 기본 동작이 유지

## 1. 테스트 계층 (필수 순서)

### Layer A: Unit / Contract (항상 실행)

대상:

1. 워크플로우 검증/실행기
2. fallback patch validator
3. env parser
4. KR 시나리오 정의 계약
5. LLM model registry/provider env parser/provider matrix 계약

명령:

```bash
cd runtime
npm test
npm run typecheck
```

### Layer B: Full-Flow Simulation (항상 실행)

대상:

1. 결정론 실행
2. selector recovery
3. vision recovery
4. human-loop decision(`go/not_go/revise`)

명령:

```bash
cd runtime
npm run test:full-flow
```

### Layer C: KR Live Smoke (옵트인)

대상:

1. 네이버/다음 실사이트 접근
2. 검색/키워드 검증
3. 스크린샷/JSON 아티팩트 생성

명령:

```bash
cd runtime
npm run test:e2e:kr
```

### Layer D: 외부 AI 비서 통합 (외부 프로젝트 담당)

대상:

1. Slack/Telegram webhook
2. 메시지 라우팅/세션 관리
3. DecisionPort 연결

명령/도구는 외부 프로젝트에서 정의한다.

### Layer E: Multi-Vendor LLM + YOLO26 Matrix

대상:

1. Gemini/OpenAI/Anthropic 멀티 모델 호출
2. YOLO26 멀티 모델 호출
3. 모델별 실패/성공 집계 리포트

명령:

```bash
cd runtime
npm run test:provider:contract
# 실제 키/엔드포인트가 있으면:
npm run test:e2e:provider:live
```

## 2. 시나리오 매트릭스

### 2.1 시뮬레이션 플로우

1. `full_pass_with_revise`: revise 후 pass
2. `full_blocked_not_go`: 사용자 중단
3. `full_fail_selector_unrecoverable`: selector 복구 실패

위 시나리오는 `runtime/tests/automation-full-flow.test.ts`에서 검증한다.

### 2.2 KR 라이브 플로우

1. `kr_naver_home_searchbox`
2. `kr_naver_search_weather`
3. `kr_daum_home_searchbox`
4. `kr_daum_search_news`
5. `kr_naver_news_home`
6. `kr_naver_finance_home`

시나리오 소스: `runtime/src/e2e/kr-scenarios.ts`

### 2.3 Provider Matrix 플로우

1. `gemini` 2개 이상 모델
2. `openai` 2개 이상 모델
3. `anthropic` 2개 이상 모델
4. `yolo26` 2개 이상 모델

검증 코드:

1. `runtime/tests/provider-matrix-env.test.ts`
2. `runtime/tests/provider-model-matrix.test.ts`
3. `runtime/tests/provider-http-executor.test.ts`
4. `runtime/tests/e2e-provider-matrix-mock.test.ts`
5. `runtime/tests/e2e-provider-live.test.ts`

## 3. 합격 기준

1. Layer A/B는 항상 100% pass
2. Layer C는 6개 이상 시나리오 중 80% 이상 pass
3. Layer E(contract)는 100% pass
4. Layer E(live)는 matrix total의 80% 이상 pass
5. Layer C/E 실패 시 screenshot/json 리포트가 남아야 함
6. `scripts/validate-run-artifacts.sh` pass

## 4. 실패 대응

1. selector 불안정: 시나리오 셀렉터 완화 + 회귀 테스트 추가
2. 사이트 UI 변경: 키워드/URL 중심 검증으로 보수적 수정
3. 일시적 네트워크 실패: 재시도 후 동일 실패 시 quarantine 기록
4. 특정 provider 장애: 해당 모델만 fail로 기록하고 matrix 전체는 계속 실행

## 5. 권장 실행 순서 (로컬)

```bash
cd runtime
npm install
npx playwright install chromium
cp .env.example .env
npm run test:automation:full
npm run test:provider:contract
npm run test:e2e:kr
# 실제 키/엔드포인트가 있으면:
npm run test:e2e:provider:live
cd ..
./scripts/validate-run-artifacts.sh
```

참고: 라이브 테스트는 `runtime/.env`를 자동 로딩한다.
