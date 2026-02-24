# CODEX E2E TESTING

## 0. 목적

웹 자동화 코어를 외부 AI 비서 프로젝트에서 붙여 쓸 때, 사전 품질 검증을 재현 가능하게 수행한다.

## 1. 테스트 계층

1. 계약 테스트(`contract`): 시나리오 정의 품질, 중복 ID, 최소 케이스 수 검증
2. 라이브 스모크(`live smoke`): 실제 한국 사이트 접속/기본 상호작용/검증
3. 통합 E2E(`assistant integration`): 외부 비서 프로젝트에서 webhook/메시징 연동 포함 검증

이 저장소는 1~2를 담당하고, 3은 외부 AI 비서 프로젝트에서 담당한다.

## 2. 한국 사이트 중심 스모크 시나리오

소스: `runtime/src/e2e/kr-scenarios.ts`

1. `kr_naver_home_searchbox`: 네이버 메인 접근 + 검색 입력창 확인
2. `kr_naver_search_weather`: 네이버 검색(날씨) 결과에서 질의어 유지 확인
3. `kr_daum_home_searchbox`: 다음 메인 접근 + 검색 입력창 확인
4. `kr_daum_search_news`: 다음 검색(뉴스) 결과 핵심 키워드 확인
5. `kr_naver_news_home`: 네이버 뉴스 메인 접근 + 뉴스 키워드 확인
6. `kr_naver_finance_home`: 네이버 금융 메인 접근 + 증권/금융 키워드 확인

## 3. 실행 방법

사전 준비:

```bash
cd runtime
npm install
npx playwright install chromium
```

실행:

```bash
cd runtime
npm run test:e2e:kr:contract
npm run test:e2e:kr
```

## 4. 결과 아티팩트

- 경로: `runs/samples/artifacts/e2e/YYYY-MM-DD/`
- 파일:
1. `*.png`: 시나리오 완료 시점 스크린샷
2. `*.json`: 시나리오 ID/도메인/최종 URL/상태

## 5. 운영 규칙

1. 라이브 테스트는 opt-in 환경에서만 실행한다(`RUN_KR_E2E=1`).
2. 로그인/결제/개인정보 입력 시나리오는 포함하지 않는다.
3. 사이트 변경으로 flaky가 발생하면 시나리오를 삭제하지 말고, selector/검증 규칙을 보수적으로 조정한다.
4. 실패가 2회 이상 반복되면 해당 시나리오를 `quarantine` 목록으로 옮기고 원인 기록을 남긴다.
