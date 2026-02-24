> Language: [English](./2026-02-24-assistantless-chat-loop-e2e-plan.en.md) | [한국어](./2026-02-24-assistantless-chat-loop-e2e-plan.md)

# Assistantless Chat-Loop E2E Implementation Plan (EN)

Goal:
- Validate screenshot-sharing + LLM analysis + rule-first loop + revise/not_go path without external assistant integration.

Key tasks:
1. Add contract tests for assistantless orchestrator.
2. Sync acceptance tests, npm scripts, and boundary docs.
3. Improve provider model matrix and YOLO26 local path behavior.
4. Run verification suite and artifact validation.

Validation commands:
```bash
cd runtime
npm run test:e2e:assistantless:contract
npm run test:provider:contract
npm run test:full-flow
npm run test:acceptance
npm test
npm run typecheck
```
