> Language: [English](./2026-02-24-backend-first-sdk-and-self-improvement-plan.en.md) | [한국어](./2026-02-24-backend-first-sdk-and-self-improvement-plan.md)

# Backend-first SDK + Self-Improvement Reinforcement Plan

## 0. Goal

Standardize usage as `Backend-first + SDK-internal` so external assistant projects can consume this repository reliably.

## 1. Problem Statement

Current gaps:

1. many modules exist but there is no clear single SDK entrypoint
2. failed run outcomes are not tightly connected to evolution triggering
3. backend-friendly auto-improvement endpoint is missing
4. usage docs are distributed and not flow-centric for integration teams

## 2. Architecture Decision

Recommended model:

1. external project calls backend APIs
2. SDK is internal orchestration layer inside backend runtime
3. failed outcomes trigger evolution only under policy constraints
4. promotion is manual by default; auto-approve is policy-driven optional behavior

## 3. Implementation Scope

1. consolidated export entrypoint: `runtime/src/index.ts`
2. SDK layer: `runtime/src/sdk/automation-sdk.ts`
3. auto-improvement bridge: `runtime/src/evolution/auto-improvement-orchestrator.ts`
4. API client: `runtime/src/sdk/evolution-api-client.ts`
5. endpoint: `POST /evolution/auto-improve`
6. runnable examples under `runtime/examples/`
7. SDK-focused tests under `runtime/tests/`
8. EN/KR usage docs

## 4. Test Strategy

1. unit tests for trigger and auto-approve policy
2. contract tests for `runWithImprovement`
3. API tests for client/server integration
4. regression with existing evolution + runtime suite

## 5. Done Criteria

1. `npm run test:sdk` passes
2. `npm run test:evolution` passes
3. `npm run typecheck` and `npm test` pass
4. bilingual docs provide end-to-end integration flow
