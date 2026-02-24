# CODEX INTEGRATION BOUNDARY

## 0. 목적

이 저장소와 외부 AI 비서 프로젝트의 책임 경계를 명확히 정의한다.

## 1. 이 저장소가 담당하는 것 (Web Automation Core)

1. 워크플로우 해석/실행(`runtime/src/workflow`, `runtime/src/engine`)
2. 실패 복구(Selector/Vision patch-only 경로)
3. 스크린샷 기반 승인 루프의 코어 로직(`runtime/src/integration/human-loop-runtime.ts`)
4. 실행 아티팩트 타입/검증 규칙

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
