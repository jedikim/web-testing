> Language: [English](./CODEX-SDK-BACKEND-USAGE.en.md) | [한국어](./CODEX-SDK-BACKEND-USAGE.md)

# CODEX SDK + BACKEND USAGE

최종 업데이트: 2026-02-25 (KST)

## 0. 목적

이 문서는 프로젝트를 다음 두 방식으로 사용하는 방법을 설명합니다:
1. backend-first (HTTP API)
2. SDK-first (코드 임베딩)

두 모드는 동일한 세션/안전 계약을 공유합니다.

## 1. 운영 모드

### 1.1 `backend_simple`

최소 연동 비용으로 사용할 때 선택합니다.

실행:
```bash
cd runtime
npm run backend:simple:server
```

기본 주소: `http://127.0.0.1:4888`

핵심 엔드포인트:
1. `GET /health`
2. `POST /backend/sessions`
3. `POST /backend/sessions/:id/turns`
4. `GET /backend/sessions/:id/stream`
5. `GET /backend/sessions/:id/screenshot`
6. `GET /backend/sessions/:id/handoffs`

### 1.2 `chat_automation_example`

채팅형 제어와 진행 가시성이 필요할 때 선택합니다.

실행:
```bash
cd runtime
npm run example:chat-backend
```

기본 주소: `http://127.0.0.1:4999`

핵심 엔드포인트:
1. `POST /example/chat/sessions`
2. `POST /example/chat/sessions/:id/message`
3. `GET /example/chat/sessions/:id/stream`
4. `POST /example/chat/sessions/:id/pause`
5. `POST /example/chat/sessions/:id/resume`
6. `POST /example/chat/sessions/:id/cancel`
7. `POST /example/chat/sessions/:id/captcha`
8. `POST /example/chat/sessions/:id/handoffs/:handoffId/resolve`
9. `GET /example/chat/progress/stream`
10. `GET /example/chat/ui`

메시지 옵션:
- `browserMode`: `headful` 또는 `headless`
- `autoPauseOthers`: 같은 operator의 기존 실행 자동 일시정지
- `attachments[]`: `url`, `path`, `dataUrl` 지원

### 1.3 `sdk_detailed`

애플리케이션 코드에서 세밀한 제어가 필요할 때 사용합니다.

엔트리포인트:
1. `createWebAutomationSdk`
2. `createMultiTurnAutomationSdk`
3. `createEvolutionApiClient`

## 2. 백엔드 사용 예시

### 2.1 세션 생성 (chat backend)

```bash
curl -s http://127.0.0.1:4999/example/chat/sessions \
  -H 'content-type: application/json' \
  -d '{"title":"pangyo planner","operatorId":"operator-main"}'
```

### 2.2 첨부 포함 메시지 전송

```bash
curl -s http://127.0.0.1:4999/example/chat/sessions/<SESSION_ID>/message \
  -H 'content-type: application/json' \
  -d '{
    "content":"첨부 이미지와 비슷한 신발을 네이버 이미지 검색에서 찾아줘",
    "browserMode":"headful",
    "operatorId":"operator-main",
    "autoPauseOthers":true,
    "attachments":[
      {"name":"shoe.png","dataUrl":"data:image/png;base64,<BASE64>"}
    ]
  }'
```

### 2.3 진행 스트림 확인

```bash
curl -N http://127.0.0.1:4999/example/chat/sessions/<SESSION_ID>/stream
```

## 3. SDK 사용 예시

```ts
import { createMultiTurnAutomationSdk } from '../src/index';

const sdk = createMultiTurnAutomationSdk();
const session = await sdk.createSession({ mode: 'sdk_detailed', title: 'kr-flow' });

const result = await sdk.sendUserTurn({
  sessionId: session.id,
  content: '결정론 우선 실행 후 selector drift가 생기면 복구해.'
});

console.log(result.assistantTurn.content);
```

## 4. 반복 아이템 이미지 판단 체인

리스트 이미지가 반복되는 경우:
1. 아이템 이미지를 합성 이미지 1장으로 병합
2. YOLO26 우선 실행
3. 불확실하면 같은 합성 이미지로 VLM 재판단
4. 탐지 결과를 원본 아이템 ID로 역매핑

모듈:
1. `runtime/src/vision/composite-sheet.ts`
2. `runtime/src/vision/repeated-item-judgement.ts`

## 5. Evolution 연동

`createEvolutionApiClient`로 진화 잡을 제어합니다:
1. 잡 생성/조회
2. diff/버전 조회
3. approve/reject/retry
4. active pointer rollback

진화는 신규 요청마다가 아니라 bug/exception 실패에서만 트리거합니다.

## 6. 모델 정책

1. 코딩/자가개선: `gemini-3.1-pro-preview`
2. 자동화 턴: `gemini-3.0-flash`
3. OpenAI 모델: `gpt-5.2-codex`, `gpt-5-mini`
4. YOLO26 기본: `yolo26l`

## 7. 안전 규칙

1. 캡차/2FA 우회 자동화 금지
2. 보안 챌린지는 human handoff로 처리
3. 결정론/patch-only 경로를 항상 우선
