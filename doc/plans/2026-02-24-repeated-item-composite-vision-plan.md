> Language: [English](./2026-02-24-repeated-item-composite-vision-plan.en.md) | [한국어](./2026-02-24-repeated-item-composite-vision-plan.md)

# 반복 아이템 합성 비전 플랜

## 0. 목표

쇼핑/리스트형 반복 이미지 상황에서 아래 체인을 구현한다.

1. 반복 아이템 분석 필요 여부를 LLM 또는 코드 콜백으로 판단
2. 여러 이미지를 하나의 합성 이미지로 생성
3. 합성 이미지 기준으로 RFDETR 1차 판단
4. YOLO 판단이 약하면 동일 합성 이미지를 VLM에 재판단 요청
5. 최종 결과를 원본 아이템 ID로 역추적

## 1. 현재 갭

기존 코드에는 ROI batch와 visual recovery는 있으나,
반복 아이템용 실제 합성 이미지 생성 + 동일 이미지 기준 YOLO->VLM 폴백 + 원본 역추적 체인이 없다.

## 2. 설계 결정

### 2.1 비전 유틸 계층 추가

`runtime/src/vision/composite-sheet.ts` 추가:

- 여러 아이템 이미지를 그리드 합성
- `tile bbox -> source item` 매핑 메타데이터 저장
- 탐지 bbox를 원본 아이템으로 역매핑

### 2.2 판단 오케스트레이션 추가

`runtime/src/vision/repeated-item-judgement.ts` 추가:

- compose -> YOLO -> 품질판단 -> VLM fallback 체인 실행
- YOLO와 VLM 모두 동일 `compositeImagePath` 사용
- 최종 판단 결과 + 역추적 결과 리포트 반환

### 2.3 런타임 통합

`runtime/src/testing/assistantless-chat-e2e.ts` 확장:

- 반복 아이템 트리거 콜백
- 목록 이미지 수집 콜백
- YOLO 판단 콜백
- VLM fallback 콜백
- 메트릭 추가: composite build 수, yolo 호출 수, vlm 호출 수, fallback 횟수

### 2.4 provider executor 확장

`runtime/src/testing/provider-http-executor.ts` 확장:

- `visionInput`을 string 또는 string[] 허용
- 배열이면 합성 경로 생성 헬퍼 사용
- composite 판단용 VLM endpoint 호출 지원

## 3. 데이터 계약

### 3.1 합성 소스 아이템

- `id`
- `imagePath`
- optional metadata

### 3.2 합성 타일 매핑

- `sourceId`
- `sourcePath`
- 합성 이미지 내 `tileBbox`
- 행/열 정보

### 3.3 탐지 역추적

- 합성 이미지 기준 detection bbox
- 매핑된 원본 item id/path
- confidence/label

## 4. 법적/안전 정책

1. 캡차/2FA 우회 자동화는 계속 비활성
2. 본 기능은 리스트 아이템 분석 목적에 한정
3. 보안 게이트는 기존대로 human handoff 유지

## 5. 테스트

1. `composite-sheet.test.ts`: 합성 + 매핑 + 역추적
2. `repeated-item-judgement.test.ts`: YOLO 성공, YOLO->VLM 동일 이미지 폴백
3. `assistantless-chat-e2e.test.ts`: 반복 아이템 합성 체인 테스트 추가
4. `provider-http-executor.test.ts`: visionInput 배열 입력 처리 테스트 추가

## 6. 완료 기준

1. 합성 이미지 + 매핑 아티팩트 생성
2. YOLO 판단 부족 시 동일 합성 이미지로 VLM 호출
3. 결과를 원본 아이템 ID로 역추적 가능
4. 테스트 통과 + EN/KR 문서 반영 완료
