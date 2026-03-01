> Language: [English](./CODEX-PRACTICAL-USAGE.en.md) | [한국어](./CODEX-PRACTICAL-USAGE.md)

# CODEX 실사용 가이드

최종 업데이트: 2026-02-25 (KST)

## 0. 목적

실전 운영 관점에서 다음 사용 방식을 설명합니다:
1. backend-simple 모드
2. chat automation backend 모드
3. SDK 임베딩 모드

## 1. 실전 안전 기준

1. 실제 검증은 headful(`PW_HEADLESS=0`) 우선
2. 불확실 단계마다 스크린샷 저장
3. 캡차/2FA/보안 챌린지 즉시 handoff
4. 산출물은 gitignored `testing/`에 저장

## 2. 실전 워크플로우 템플릿

다음 같은 목표에 동일하게 적용합니다:
- "날씨 확인 후 판교 기준 아이와 갈만한 곳 탐색"
- "첨부 이미지와 비슷한 상품 탐색"

루프:
1. 현재 상태 스크린샷 캡처
2. 목표/페이지 상태 분석
3. 결정론 스텝 실행
4. 결과 검증
5. 실패 시 제한된 복구 경로 실행
6. 보안/차단 구간이면 human handoff
7. 완료까지 반복

### 2.1 DOM 처리 전략 (성능/안정성)

웹 조작 도구 호출 전에 아래 순서를 지킵니다:
1. 전체 DOM 임베딩 금지
2. 구조 기반 후보 축소(nav/role/header/aria-expanded/링크 밀집 영역 등)로 1차 후보군 생성
3. 목표가 명확해진 순간에만 부분 벡터화 수행(후보 20~100개 범위)
4. 페이지 단위 인메모리 인덱스 검색 사용(`hnswlib-node` 가능 시 사용, 없으면 brute-force cosine)
5. LLM에는 전체 DOM이 아닌 상위 후보 context만 전달

핵심:
1. 병목은 검색이 아니라 임베딩
2. 동일 페이지 반복에서는 embedding cache 재사용

## 3. Chat Backend 실전 예시

### 3.1 서버 실행

```bash
cd runtime
npm run example:chat-backend
```

참고:
1. 기본 실행 모드는 `playwright`(시뮬레이션 아님, 실제 액션)입니다.
2. 시뮬레이션 강제는 `CHAT_AUTOMATION_EXECUTION_MODE=simulate`로 설정합니다.
3. `browserMode=headful`에서 GUI 실행 실패 시 런타임 로그에 headful fallback 경고가 기록됩니다.

### 3.2 세션 생성

```bash
curl -s http://127.0.0.1:4999/example/chat/sessions \
  -H 'content-type: application/json' \
  -d '{"title":"pangyo weather+map","operatorId":"operator-main"}'
```

### 3.3 목표 메시지 전송

```bash
curl -s http://127.0.0.1:4999/example/chat/sessions/<SESSION_ID>/message \
  -H 'content-type: application/json' \
  -d '{
    "content":"오늘 날씨 확인하고 판교 기준 아이와 갈만한 곳을 네이버 지도에서 찾아줘",
    "browserMode":"headful",
    "operatorId":"operator-main",
    "autoPauseOthers":true
  }'
```

### 3.4 이미지 첨부 메시지 전송

```bash
curl -s http://127.0.0.1:4999/example/chat/sessions/<SESSION_ID>/message \
  -H 'content-type: application/json' \
  -d '{
    "content":"첨부 이미지와 비슷한 상품을 네이버 이미지 검색에서 찾아줘",
    "browserMode":"headful",
    "operatorId":"operator-main",
    "attachments":[
      {"name":"reference.png","dataUrl":"data:image/png;base64,<BASE64>"}
    ]
  }'
```

### 3.5 실시간 로그 관찰

```bash
curl -N http://127.0.0.1:4999/example/chat/sessions/<SESSION_ID>/stream
```

### 3.6 캡차 handoff 입력

```bash
curl -s http://127.0.0.1:4999/example/chat/sessions/<SESSION_ID>/captcha \
  -H 'content-type: application/json' \
  -d '{"value":"A1B2C3"}'
```

## 4. SDK 실전 예시

```ts
import { createWebAutomationSdk } from '../src/index';

const sdk = createWebAutomationSdk();
const result = await sdk.runWithImprovement({
  workflowId: 'wf-kr-practical',
  targetUrl: 'https://www.naver.com',
  objective: 'weather then family-friendly nearby places',
  run: async () => {
    return {
      status: 'fail',
      failures: [{ code: 'SelectorNotFound', message: 'search input changed' }]
    };
  }
});

console.log(result);
```

## 5. 운영 검토 체크리스트

런 종료 후 확인:
1. run 상태와 step trace
2. screenshot/handoff 증적
3. 실패 분류와 복구 액션
4. evolution 트리거 적절성(버그/예외 기반)
5. 안전 정책 위반 여부

## 6. 다음 문서

1. [SDK + Backend Usage](./CODEX-SDK-BACKEND-USAGE.md)
2. [E2E Testing Guide](./CODEX-E2E-TESTING.md)
3. [Environment Setup](./CODEX-ENV-SETUP.md)
