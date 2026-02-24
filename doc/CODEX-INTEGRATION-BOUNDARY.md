> Language: [English](./CODEX-INTEGRATION-BOUNDARY.en.md) | [한국어](./CODEX-INTEGRATION-BOUNDARY.md)

# CODEX INTEGRATION BOUNDARY

## 0. 목적

이 저장소와 외부 AI 비서 프로젝트의 책임 경계를 명확히 정의한다.

## 1. 이 저장소가 담당하는 것 (Web Automation Core)

1. 워크플로우 해석/실행(`runtime/src/workflow`, `runtime/src/engine`)
2. 실패 복구(Selector/Vision patch-only 경로)
3. 스크린샷 기반 승인 루프의 코어 로직(`runtime/src/integration/human-loop-runtime.ts`)
4. 실행 아티팩트 타입/검증 규칙
5. AI 비서 연동 없이 채팅형 루프를 재현하는 assistantless E2E 시뮬레이션(`runtime/src/testing/assistantless-chat-e2e.ts`)
6. bug/exception 기반 진화 백엔드(`runtime/src/evolution/*`)와 승인 전환 포인터 관리

## 2. 외부 AI 비서 프로젝트가 담당하는 것

1. Telegram/Slack/기타 챗 채널 webhook/서명 검증
2. 사용자 메시지 수신/전송 및 세션 라우팅
3. 비서 프롬프트/도구 호출/메모리 전략
4. 운영 배포(systemd, launchd, secrets, 네트워크 보안)

## 3. 연결 계약 (Port Contract)

외부 프로젝트는 아래 계약만 구현하면 된다.

1. `DecisionPort.requestDecision(...)`를 구현해 `go/not_go/revise/unknown` 반환
2. `runHumanLoop(...)` 호출 시 `run()`과 `reviseWithLlm()`를 주입
3. 스크린샷 파일 경로/질문 문자열은 외부 채널 포맷에 맞게 변환

## 4. 설계 원칙

1. 이 저장소는 특정 채널 SDK에 하드 의존하지 않는다.
2. 외부 채널이 바뀌어도 코어 자동화 로직은 변경하지 않는다.
3. 민감 액션은 `go` 승인 없이는 실행하지 않는다.

## 5. 세션/이벤트 JSON 계약

### 5.1 Backend Simple (`/backend/*`)

핵심 조회 엔드포인트:

1. `GET /backend/sessions/:id`
2. `GET /backend/sessions/:id/stream` (SSE snapshot)
3. `GET /backend/sessions/:id/screenshot`
4. `GET /backend/sessions/:id/handoffs`

`GET /backend/sessions/:id/screenshot` 응답 예시:

```json
{
  "ok": true,
  "data": {
    "path": "/tmp/backend-shot.png",
    "source": "turn_screenshot",
    "capturedAt": "2026-02-24T12:00:00.000Z",
    "turnId": "sess-...-turn-3"
  }
}
```

### 5.2 Chat Automation (`/example/chat/*`)

`GET /example/chat/sessions/:id` 및 SSE `snapshot` 이벤트는 아래 스키마를 따른다.

```json
{
  "schemaVersion": "chat.session.snapshot.v1",
  "emittedAt": "2026-02-24T12:00:00.000Z",
  "session": { "id": "sess-..." },
  "run": { "status": "running", "queueLength": 1 },
  "logs": [{ "id": "log-1", "level": "info", "message": "Run started" }],
  "handoffs": [
    {
      "id": "sess-...-handoff-1",
      "type": "captcha",
      "status": "waiting",
      "prompt": "Security challenge detected. Enter captcha value to continue.",
      "requestedAt": "2026-02-24T12:00:10.000Z"
    }
  ],
  "latestScreenshot": {
    "path": "/.../uploads/reference.png",
    "source": "attachment",
    "capturedAt": "2026-02-24T12:00:05.000Z"
  }
}
```

보조 엔드포인트:

1. `GET /example/chat/sessions/:id/handoffs`
2. `GET /example/chat/sessions/:id/screenshot`
3. `POST /example/chat/sessions/:id/handoffs/:handoffId/resolve`
4. `GET /example/chat/progress/stream` (SSE progress)

`GET /example/chat/progress/stream` 이벤트 스키마:

```json
{
  "schemaVersion": "chat.progress.event.v1",
  "eventType": "session_snapshot",
  "emittedAt": "2026-02-24T12:00:00.000Z",
  "sessionId": "sess-...",
  "operatorId": "default-operator",
  "runStatus": "running",
  "snapshot": {
    "schemaVersion": "chat.session.snapshot.v1"
  }
}
```

### 5.3 Evolution (`/evolution/*`)

운영/복구 계약에서 사용되는 추가 엔드포인트:

1. `POST /evolution/versions/:workflowId/rollback`
2. `GET /evolution/progress/stream` (SSE progress)

`POST /evolution/versions/:workflowId/rollback` 요청 예시:

```json
{
  "targetVersion": 1,
  "confirmedBy": "operator",
  "note": "restore stable pointer"
}
```

`GET /evolution/progress/stream` 이벤트 스키마:

```json
{
  "schemaVersion": "evolution.progress.event.v1",
  "eventType": "job_snapshot",
  "emittedAt": "2026-02-24T12:00:00.000Z",
  "workflowId": "kr-scenario-001",
  "jobId": "evo-...",
  "status": "testing",
  "snapshot": {
    "schemaVersion": "evolution.job.snapshot.v1"
  }
}
```
