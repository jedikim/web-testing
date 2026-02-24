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

## 3. 합격 기준

1. Layer A/B는 항상 100% pass
2. Layer C는 6개 이상 시나리오 중 80% 이상 pass
3. Layer C 실패 시 screenshot/json 아티팩트가 남아야 함
4. `scripts/validate-run-artifacts.sh` pass

## 4. 실패 대응

1. selector 불안정: 시나리오 셀렉터 완화 + 회귀 테스트 추가
2. 사이트 UI 변경: 키워드/URL 중심 검증으로 보수적 수정
3. 일시적 네트워크 실패: 재시도 후 동일 실패 시 quarantine 기록

## 5. 권장 실행 순서 (로컬)

```bash
cd runtime
npm install
npx playwright install chromium
npm run test:automation
npm run test:e2e:kr
cd ..
./scripts/validate-run-artifacts.sh
```
