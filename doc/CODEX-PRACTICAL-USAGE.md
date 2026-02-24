> Language: [English](./CODEX-PRACTICAL-USAGE.en.md) | [한국어](./CODEX-PRACTICAL-USAGE.md)

# CODEX 실사용 가이드

## 0. 목적

실제 운영에서 바로 쓸 수 있도록 아래 두 가지 사용 패턴을 정리한다.

1. `backend_simple` (HTTP 서비스 형태)
2. `chat_automation_example` (채팅형 제어 + 실시간 로그/진행 표시)
3. `sdk_detailed` (SDK 임베딩 형태)

법적 안전 원칙에 따라 캡차/2FA 우회 자동화는 제외한다.

## 1. 법적 안전 원칙 (중요)

1. 캡차/2FA/보안 챌린지 자동 풀이/우회 로직은 운영 경로에 넣지 않는다.
2. 해당 게이트가 나오면 자동화는 즉시 중단하고 human decision을 요청한다.
3. 사람 결정(`go`, `revise`, `not_go`) 후에만 재개/중단을 확정한다.

## 2. Backend Simple 실전 플로우

### 2.1 서버 실행

```bash
cd runtime
npm run backend:simple:server
```

기본 주소: `http://127.0.0.1:4888`

### 2.2 세션 생성

```bash
curl -s http://127.0.0.1:4888/backend/sessions \
  -H 'content-type: application/json' \
  -d '{
    "mode": "backend_simple",
    "title": "판교 기준 날씨+아이동선",
    "workflowId": "wf-kr-planner",
    "systemPrompt": "deterministic-first로 진행하고 불확실하면 screenshot checkpoint 요청"
  }'
```

### 2.3 사용자 턴 전송

```bash
curl -s http://127.0.0.1:4888/backend/sessions/<SESSION_ID>/turns \
  -H 'content-type: application/json' \
  -d '{
    "content": "오늘 날씨 확인 후 판교에서 갈만한 서울 근교 아이 장소를 3개 추려줘",
    "screenshotPath": "testing/backend/state/example-step1.png"
  }'
```

### 2.4 세션 기록 조회

```bash
curl -s http://127.0.0.1:4888/backend/sessions/<SESSION_ID>
```

### 2.5 세션 종료

```bash
curl -s -X POST http://127.0.0.1:4888/backend/sessions/<SESSION_ID>/close \
  -H 'content-type: application/json' \
  -d '{}'
```

## 3. Chat Automation Example Backend 실전 플로우

### 3.1 백엔드 + 채팅 UI 실행

```bash
cd runtime
npm run example:chat-backend
```

기본 UI 주소: `http://127.0.0.1:4999/example/chat/ui`

### 3.2 세션 생성 + 첫 목표 전송

```bash
curl -s http://127.0.0.1:4999/example/chat/sessions \
  -H 'content-type: application/json' \
  -d '{
    "title": "판교 자동화 플래너",
    "operatorId": "operator-main"
  }'
```

```bash
curl -s http://127.0.0.1:4999/example/chat/sessions/<SESSION_ID>/message \
  -H 'content-type: application/json' \
  -d '{
    "content": "첨부한 사진과 비슷한 것을 네이버 이미지 검색에서 찾아줘",
    "browserMode": "headful",
    "operatorId": "operator-main",
    "autoPauseOthers": true,
    "attachments": [
      {
        "name": "reference-shoe.png",
        "mimeType": "image/png",
        "dataUrl": "data:image/png;base64,<BASE64>"
      }
    ]
  }'
```

### 3.3 진행상태/로그 연속 확인

```bash
curl -N http://127.0.0.1:4999/example/chat/sessions/<SESSION_ID>/stream
```

이 스트림은 실행 스텝과 로그를 지속적으로 내보내며, 예제 UI가 실시간으로 표시한다.

### 3.4 새 대화 시작 시 이전 세션 일시정지

같은 `operatorId`에서 다른 세션으로 새 메시지를 보내고 `autoPauseOthers=true`면 이전 실행 세션이 `paused`로 전환된다.

### 3.5 캡차/보안 챌린지 사용자 입력

상태가 `waiting_captcha`가 되면 사용자 입력을 제출한다.

```bash
curl -s http://127.0.0.1:4999/example/chat/sessions/<SESSION_ID>/captcha \
  -H 'content-type: application/json' \
  -d '{"value":"A1B2C3"}'
```

이후 재개:

```bash
curl -s http://127.0.0.1:4999/example/chat/sessions/<SESSION_ID>/resume \
  -H 'content-type: application/json' \
  -d '{}'
```

## 4. SDK Detailed 실전 플로우

### 4.1 기본 멀티턴 사용

```ts
import { createMultiTurnAutomationSdk } from '../src/index';

const sdk = createMultiTurnAutomationSdk();

const session = await sdk.createSession({
  mode: 'sdk_detailed',
  title: 'kr multi-step planner',
  workflowId: 'wf-kr-complex'
});

const turn = await sdk.sendUserTurn({
  sessionId: session.id,
  content: '날씨 확인 -> 지도 검색 -> 후보 3개 확정 순서로 진행해.'
});

console.log(turn.assistantTurn.content);
```

로컬 예제 실행:

```bash
cd runtime
npm run example:sdk:multiturn
```

### 4.2 Human handoff 예제

```bash
cd runtime
npm run example:sdk:human-handoff
```

이 예제는 민감/차단 상황에서 자동화가 `blocked` 상태로 멈추고 사람 결정을 기다리는 흐름을 보여준다.

### 4.3 반복 리스트 이미지 합성 (YOLO -> VLM fallback)

쇼핑몰 리스트처럼 아이템 이미지가 반복될 때 아래 체인을 사용한다.

1. 아이템 이미지를 하나의 합성 이미지로 생성
2. 합성 이미지 기준으로 YOLO26 1차 판단
3. YOLO 판단이 약하면 동일 합성 이미지로 VLM 재판단
4. 탐지 bbox를 원본 아이템 ID로 역추적

```ts
const result = await runAssistantlessChatE2E({
  ...baseInput,
  shouldRunRepeatedItemComposite: async () => true,
  collectRepeatedItemImages: async () => itemImages,
  judgeRepeatedItemsWithYolo: async ({ compositeImagePath, manifest }) => {
    return yoloJudge(compositeImagePath, manifest);
  },
  judgeRepeatedItemsWithVlm: async ({ compositeImagePath, yolo, mappedDetections }) => {
    return vlmJudge(compositeImagePath, yolo, mappedDetections);
  }
});
```

관련 코드:

- `runtime/src/vision/composite-sheet.ts`
- `runtime/src/vision/repeated-item-judgement.ts`
- `runtime/src/testing/assistantless-chat-e2e.ts`

실행 예제:

```bash
cd runtime
npm run example:repeated-item
```

## 5. Human Handoff 계약

코어 계약:

- integration 레이어의 `runHumanLoop(...)`
- decision 요청 데이터: `workflowId`, `screenshotPath`, `question`
- decision 결과: `go | revise | not_go | unknown`

동작 규칙:

1. `go`: 계속 진행
2. `revise`: 수정 함수 실행 후 재시도
3. `not_go` 또는 `unknown`: `blocked`로 중단

## 6. 운영 체크리스트

1. 실전 검증은 `PW_HEADLESS=0`으로 실행한다.
2. 불확실 단계마다 스크린샷을 남긴다.
3. 런타임/테스트 산출물은 gitignored `testing/`에 저장한다.
4. 코딩 모델은 `gemini-3.1-pro-preview`를 유지한다.
5. 자동화 상호작용 모델은 `gemini-3.0-flash`를 유지한다.

## 7. 다음 문서

- SDK + Backend 사용법: [CODEX-SDK-BACKEND-USAGE.md](./CODEX-SDK-BACKEND-USAGE.md)
- 환경설정: [CODEX-ENV-SETUP.md](./CODEX-ENV-SETUP.md)
- 런북: [CODEX-RUNBOOK.md](./CODEX-RUNBOOK.md)
