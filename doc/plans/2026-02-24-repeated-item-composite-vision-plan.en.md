> Language: [English](./2026-02-24-repeated-item-composite-vision-plan.en.md) | [한국어](./2026-02-24-repeated-item-composite-vision-plan.md)

# Repeated-Item Composite Vision Plan

## 0. Goal

Implement a robust chain for repeated listing images:

1. detect/trigger repeated-item analysis (LLM or code callback)
2. merge item images into one composite sheet
3. run RFDETR on the composite image first
4. if YOLO judgement is weak/uncertain, call VLM with the same composite image
5. map detections/judgements back to original item IDs (reverse trace)

## 1. Problem and Gap

Current runtime has ROI batching and visual recovery, but it does not produce a real merged image asset for repeated listing analysis, and provider execution still uses a single static input path without reverse tracing.

## 2. Design Decision

### 2.1 New vision utility layer

Add `runtime/src/vision/composite-sheet.ts`:

- build a grid-style composite image from multiple item images
- store mapping metadata (`tile bbox -> source item id/path`)
- provide reverse mapping from detection bbox to original item

### 2.2 Repeated-item judgement orchestration

Add `runtime/src/vision/repeated-item-judgement.ts`:

- execute chain: compose -> YOLO -> quality check -> optional VLM fallback
- use same composed image path for both YOLO and VLM
- return decision report with mapped items and trace fields

### 2.3 Runtime integration

Extend `runtime/src/testing/assistantless-chat-e2e.ts` with optional callbacks:

- trigger callback (LLM/code decides repeated-item condition)
- collect listing item images callback
- YOLO judgement callback
- VLM fallback callback
- emit metrics: composite builds, yolo calls, vlm calls, fallback count

### 2.4 Provider executor extension

Extend `runtime/src/testing/provider-http-executor.ts`:

- allow `visionInput` as string or array
- add helper to build merged path when array is passed
- support VLM endpoint call for composite judgement

## 3. Data Contracts

### 3.1 Composite source item

- `id`
- `imagePath`
- optional metadata

### 3.2 Composite mapping tile

- `sourceId`
- `sourcePath`
- `tileBbox` on merged image
- row/column

### 3.3 Detection reverse trace

- detection bbox on merged image
- mapped source item ID/path
- confidence/label

## 4. Legal/Safety Policy

1. captcha/2FA bypass automation remains disabled
2. repeated-item composite feature is for listing analysis only
3. security gates still use human handoff

## 5. Tests

1. `composite-sheet.test.ts`: merge + mapping + reverse trace
2. `repeated-item-judgement.test.ts`: YOLO success and YOLO->VLM fallback with same path
3. extend `assistantless-chat-e2e.test.ts` for repeated-item composite chain
4. extend `provider-http-executor.test.ts` for array input/composite behavior

## 6. Done Criteria

1. merged image + mapping artifacts are produced
2. YOLO failure/uncertainty triggers VLM on same merged image
3. reverse mapping to original item IDs works
4. tests pass and docs are updated in EN/KR
