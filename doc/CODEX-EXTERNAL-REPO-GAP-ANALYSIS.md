> Language: [English](./CODEX-EXTERNAL-REPO-GAP-ANALYSIS.en.md) | [한국어](./CODEX-EXTERNAL-REPO-GAP-ANALYSIS.md)

# CODEX 외부 레포 비교 분석 (web-agentic)

## 0. 범위

비교 대상:

- 현재 프로젝트: `/home/jedi/code/web-agentic-codex`
- 외부 레포: `/home/jedi/code/web-agentic-codex/temp/web-agentic` (origin: `https://github.com/jedikim/web-agentic`)

초기 비교 시점: 2026-02-24 (external commit `34360a7`)  
상태 갱신 시점: 2026-02-25 (KST)  
원칙: 외부 레포 재클론 후 비교 분석 → 우선 수용 항목 구현/검증 반영

## 1. 핵심 결론

1. 외부 레포에서 즉시 수용 가능한 것은 `API 계약 강화`, `세션/진행 이벤트 표준화`, `테스트 픽스처 구조`, `버전/diff 조회 API`다.
2. 외부 레포의 `LLM-first` 설명, `anti-bot 우회/stealth 강화`는 현재 PRD와 충돌하므로 수용 대상이 아니다.
3. `진화 샌드박스`는 현재 프로젝트의 `git worktree` 방식이 더 안전하며 유지해야 한다.
4. 현재 프로젝트의 chat backend는 “실전형 제어 API”는 갖췄지만, 실행 엔진을 실제 브라우저 오케스트레이션으로 직접 연결하는 부분은 추가 보강 여지가 있다.

## 2. 동일점/차이점 요약

| 항목 | 현재 프로젝트 (`web-agentic-codex`) | 외부 레포 (`web-agentic`) | 판단 |
|---|---|---|---|
| 기본 철학 | Rule-first + Patch-only + Human-handoff | README는 LLM-first, PRD는 Rule-first | 외부 문서 불일치 존재 |
| 백엔드 런타임 | Node/TS HTTP 서버 (`runtime/src/backend/*`) | FastAPI + SQLite (`src/api/*`) | 구현 언어 다름, 개념은 유사 |
| 진화 엔진 | bug/exception trigger + worktree 격리 + 승인 전환 | 실패 분석 + branch sandbox + 승인/merge | 현재(worktree) 우선 유지 |
| 채팅 세션 | 멀티턴/상태/SSE/pause-resume/captcha 입력 | 세션/턴/스크린샷/handoff API | 계약은 유사, 내부 실행 방식 차이 |
| UI 샘플 | backend UI + chat UI 예제 | evolution-ui + automation/sessions 화면 | 상호 보완 가능 |
| 모델 정책 | Gemini/OpenAI 제한 + yolo26l 단일 | Gemini 중심 설정 | 현재 정책 유지 |
| 봇 회피 정책 | 우회 금지(문서 명시) | stealth/human-simulation 강조 | 외부 방식은 비수용 |

## 3. 충돌/리스크 확인

1. 외부 README는 LLM-first를 명시하지만, 외부 PRD는 Rule-first를 명시한다. 문서 일관성 리스크가 있다.
2. 외부 README의 테스트 수치(968)는 현재 파일 수(약 65 test files)와 불일치 가능성이 있어 그대로 근거로 채택하면 안 된다.
3. 외부 레포의 anti-detection/stealth는 현재 PRD의 비수용 항목과 충돌한다.

## 4. 수용 후보 (코드 변경 예정 리스트)

아래는 “다음 구현 단계에서 수정/추가할 파일 후보”를 포함한 리스트다.

### A. API/세션 계약 강화

1. `GAP-A1` 세션 API에 `session detail/screenshot/handoff` 표준 필드 정렬
   - 이유: 외부 레포처럼 클라이언트가 멀티턴 상태를 일관되게 조회 가능
   - 변경 후보:
     - `runtime/src/backend/chat-automation-server.ts`
     - `runtime/src/backend/chat-automation-service.ts`
     - `runtime/src/backend/simple-backend-server.ts`
     - `runtime/src/session/types.ts`
2. `GAP-A2` 버전/이력 조회 API 추가 (`current/versions/rollback-view`)
   - 이유: 승인 이후 운영 가시성 강화
   - 변경 후보:
     - `runtime/src/evolution/server.ts`
     - `runtime/src/evolution/storage.ts`
     - `runtime/src/evolution/types.ts`
3. `GAP-A3` evolution job diff 조회 API 추가
   - 이유: 승인 전 코드 변경점 검토 품질 향상
   - 변경 후보:
     - `runtime/src/evolution/server.ts`
     - `runtime/src/evolution/service.ts`
     - `runtime/src/evolution/git-sandbox.ts`

### B. 실행 엔진/오케스트레이션 보강

4. `GAP-B1` chat run과 실제 Playwright 실행 루프 연결 강화 (현재 시뮬레이션 중심 단계 보강)
   - 이유: chat UI E2E를 “실전형 웹 자동화”에 더 근접
   - 변경 후보:
     - `runtime/src/backend/chat-automation-service.ts`
     - `runtime/src/engine/playwright-executor.ts`
     - `runtime/src/testing/assistantless-chat-e2e.ts`
5. `GAP-B2` 실패 원인 분류 taxonomy 정교화 (session/evolution 공통 코드)
   - 이유: 자동 수정 트리거 품질 향상
   - 변경 후보:
     - `runtime/src/evolution/auto-improvement-orchestrator.ts`
     - `runtime/src/evolution/scenario-growth.ts`
     - `runtime/src/types/run-artifact.ts`

### C. 테스트 체계 보강

6. `GAP-C1` deterministic HTML fixture 기반 E2E 세트 추가
   - 이유: 라이브 사이트 의존도 낮추고 재현성 높은 회귀 테스트 확보
   - 변경 후보:
     - `runtime/tests/e2e-fixtures/*` (신규)
     - `runtime/tests/*e2e*.test.ts`
7. `GAP-C2` API 계약 테스트를 endpoint 단위 golden response로 확장
   - 이유: SDK/외부 프로젝트 연동 시 스키마 안정성 보장
   - 변경 후보:
     - `runtime/tests/chat-automation-server.test.ts`
     - `runtime/tests/backend-simple-server.test.ts`
     - `runtime/tests/evolution-server.test.ts`
8. `GAP-C3` progress event 표준 스키마 테스트 추가
   - 이유: UI/외부 어시스턴트에서 이벤트 파싱 실패 방지
   - 변경 후보:
     - `runtime/src/evolution/types.ts`
     - `runtime/src/backend/chat-automation-service.ts`
     - `runtime/tests/*stream*.test.ts`

### D. 문서/운영 가이드 보강

9. `GAP-D1` “외부 프로젝트 연동 계약” 문서에 세션/이벤트 JSON 스키마 표 추가
   - 변경 후보:
     - `doc/CODEX-INTEGRATION-BOUNDARY.md`
     - `doc/CODEX-INTEGRATION-BOUNDARY.en.md`
10. `GAP-D2` 진화 승인 전 검토 절차에 “diff API + 테스트 로그 + 증거 스크린샷” 체크리스트 추가
    - 변경 후보:
      - `doc/CODEX-EVOLUTION-BACKEND.md`
      - `doc/CODEX-EVOLUTION-BACKEND.en.md`
11. `GAP-D3` 테스트 플랜에 “fixture E2E / live E2E 분리 실행 순서” 명확화
    - 변경 후보:
      - `doc/CODEX-AUTOMATION-TEST-PLAN.md`
      - `doc/CODEX-AUTOMATION-TEST-PLAN.en.md`

## 5. 비수용 항목 (명시)

1. `LLM-first를 기본 경로로 전환`  
   - 사유: 현재 PRD의 Rule-first 원칙 위반
2. `anti-bot stealth 우회 기능 강화`  
   - 사유: 현재 PRD의 비수용/법적 안전 원칙 위반
3. `진화 샌드박스를 branch+stash 중심으로 회귀`  
   - 사유: 현재 worktree 격리 전략보다 충돌 리스크 큼
4. `외부 레포의 테스트 수치/비용 수치 문구를 그대로 채택`  
   - 사유: 현재 스냅샷과 불일치 가능성

## 6. 다음 단계 제안 (코딩 전)

1. 위 `GAP-A1~D3` 중 우선순위 확정 (`P0/P1/P2`)
2. 확정된 항목을 `doc/CODEX-IMPLEMENTATION-PLAN.md`와 테스트 플랜에 반영
3. 그 다음에만 구현 루프(Plan → Build → Test → Fix → Re-test → Review → Report) 시작

## 7. 구현 반영 상태 (2026-02-25 갱신)

완료:

1. `GAP-A2` 버전/이력 조회 API
   - `GET /evolution/versions`
   - `GET /evolution/versions/:workflowId`
   - `GET /evolution/versions/:workflowId/current`
   - `GET /evolution/versions/:workflowId/history`
2. `GAP-A3` job diff API
   - `GET /evolution/jobs/:id/diff`
3. `GAP-A1` 세션 계약 확장(핵심 조회 API)
   - `GET /backend/sessions/:id/screenshot`
   - `GET /backend/sessions/:id/handoffs`
   - `GET /example/chat/sessions/:id/screenshot`
   - `GET /example/chat/sessions/:id/handoffs`
   - chat snapshot 스키마 버전 필드 추가(`chat.session.snapshot.v1`)
4. `GAP-C1` deterministic fixture E2E
   - `runtime/tests/e2e-fixtures/deterministic-form.html`
   - `runtime/tests/e2e-fixture-playwright-adapter.test.ts`
5. `GAP-C2/C3` API 계약/스키마 테스트 강화
   - evolution/chat/backend server + sdk client 테스트 확장
6. `GAP-A2` 롤백 계약 추가
   - `POST /evolution/versions/:workflowId/rollback`
   - SDK: `rollbackVersion(workflowId, input)`
7. `GAP-C3` 전역 progress 이벤트 계약 추가
   - `GET /evolution/progress/stream` (`evolution.progress.event.v1`)
   - `GET /example/chat/progress/stream` (`chat.progress.event.v1`)
8. `GAP-A1` handoff 개별 해결 계약 추가
   - `POST /example/chat/sessions/:id/handoffs/:handoffId/resolve`
9. 안정화 픽스
   - `SessionStore` JSON read 재시도(쓰기/읽기 경합 시 SyntaxError 완화)

잔여:

1. `GAP-B1/B2` (실 브라우저 오케스트레이션 연결 강화, 실패 taxonomy 정교화) 상세 구현
2. hidden element 대응을 위한 interaction-healing 사전 스텝 자동 삽입
3. cluttered 화면에서 region-aware VLM 라우팅 보강
