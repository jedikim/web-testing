> Language: [English](./CODEX-PRACTICAL-USAGE.en.md) | [한국어](./CODEX-PRACTICAL-USAGE.md)

# CODEX 실사용 가이드

## 0. 목적

실제 운영에서 바로 쓸 수 있도록 아래 두 가지 사용 패턴을 정리한다.

1. `backend_simple` (HTTP 서비스 형태)
2. `sdk_detailed` (SDK 임베딩 형태)

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

## 3. SDK Detailed 실전 플로우

### 3.1 기본 멀티턴 사용

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

### 3.2 Human handoff 예제

```bash
cd runtime
npm run example:sdk:human-handoff
```

이 예제는 민감/차단 상황에서 자동화가 `blocked` 상태로 멈추고 사람 결정을 기다리는 흐름을 보여준다.

## 4. Human Handoff 계약

코어 계약:

- integration 레이어의 `runHumanLoop(...)`
- decision 요청 데이터: `workflowId`, `screenshotPath`, `question`
- decision 결과: `go | revise | not_go | unknown`

동작 규칙:

1. `go`: 계속 진행
2. `revise`: 수정 함수 실행 후 재시도
3. `not_go` 또는 `unknown`: `blocked`로 중단

## 5. 운영 체크리스트

1. 실전 검증은 `PW_HEADLESS=0`으로 실행한다.
2. 불확실 단계마다 스크린샷을 남긴다.
3. 런타임/테스트 산출물은 gitignored `testing/`에 저장한다.
4. 코딩 모델은 `gemini-3.1-pro-preview`를 유지한다.
5. 자동화 상호작용 모델은 `gemini-3.0-flash`를 유지한다.

## 6. 다음 문서

- SDK + Backend 사용법: [CODEX-SDK-BACKEND-USAGE.md](./CODEX-SDK-BACKEND-USAGE.md)
- 환경설정: [CODEX-ENV-SETUP.md](./CODEX-ENV-SETUP.md)
- 런북: [CODEX-RUNBOOK.md](./CODEX-RUNBOOK.md)
