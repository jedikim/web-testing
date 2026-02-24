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

## 3. Chat Backend 실전 예시

### 3.1 서버 실행

```bash
cd runtime
npm run example:chat-backend
```

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
