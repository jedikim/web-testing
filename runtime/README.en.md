> Language: [English](./README.en.md) | [한국어](./README.md)

# runtime

TypeScript runtime for rule-first adaptive web automation.

## Structure

- `src/workflow`: DSL typing/validation/execution path
- `src/engine`: deterministic runner + Playwright executor
- `src/fallback`: patch-only recovery pipeline
- `src/vision`: ROI batching and visual recovery
- `src/chat`: screenshot checkpoint loop
- `src/integration`: channel-agnostic human-loop contract
- `src/learning`: replay store and rule promotion
- `src/ops`: session/metrics/rollback/resilience
- `src/evolution`: bug/exception-driven version evolution backend
- `src/sdk`: SDK entrypoints for external embedding
- `src/index.ts`: consolidated export entrypoint
- `tests`: contracts, integration, live-e2e suites

## Local Validation

```bash
cd runtime
npm install
npm test
npm run test:acceptance
npm run test:sdk
npm run test:evolution
npm run typecheck
```

## SDK Examples

```bash
cd runtime
npm run example:sdk:basic
npm run example:sdk:auto-improve
```

Detailed guide:

- `../doc/CODEX-SDK-BACKEND-USAGE.en.md`

## Live E2E

```bash
cd runtime
npm run test:e2e:kr:headful
npm run test:e2e:assistantless:live
npm run test:e2e:autonomous:live
```

## Evolution Server

```bash
cd runtime
npm run evolution:server
```
