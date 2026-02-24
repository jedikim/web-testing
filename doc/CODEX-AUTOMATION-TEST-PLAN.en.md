> Language: [English](./CODEX-AUTOMATION-TEST-PLAN.en.md) | [한국어](./CODEX-AUTOMATION-TEST-PLAN.md)

# CODEX AUTOMATION TEST PLAN

## 0. Goal

Validate production-like behavior before deployment:
1. deterministic workflow stability
2. recovery-path reproducibility
3. Korea-site live smoke validity
4. evolution backend reliability

## 1. Mandatory Layer Order

### Layer A: Unit / Contract (always)
```bash
cd runtime
npm test
npm run typecheck
```

### Layer B: Full Flow Simulation (always)
```bash
cd runtime
npm run test:full-flow
```

### Layer C: KR Live Smoke (opt-in)
```bash
cd runtime
npm run test:e2e:kr
npm run test:e2e:kr:headful
```

### Layer D: Assistantless Chat Loop
```bash
cd runtime
npm run test:e2e:assistantless:contract
npm run test:e2e:assistantless:live
npm run test:e2e:autonomous:live
```

### Layer E: External Assistant Integration
Owned by external project.

### Layer F: Multi-Vendor LLM + YOLO26 Matrix

Scope:
1. LLM providers: `gemini`, `openai` only
2. default model set: `gemini-3.1-pro-preview,gemini-3.0-flash` and `gpt-5.2-codex,gpt-5-mini`
3. YOLO26 default model set: `yolo26l`

```bash
cd runtime
npm run test:provider:contract
npm run test:e2e:provider:live
```

### Layer G: Evolution Backend (bug/exception only)
```bash
cd runtime
npm run test:evolution
```

### Layer H: SDK + Backend Contract
```bash
cd runtime
npm run test:sdk
```

## 2. Complex Scenario Coverage

The autonomous live batch includes multi-step KR-focused scenarios:
- weather + family place search around Pangyo (map.naver)
- cross-site planning (weather + map + search)
- weekend multi-source route planning (13+ steps)
- public-info + transport chain with captcha retries
- budget/route + selector drift revise flow (14+ steps)

## 3. Acceptance Criteria

1. Layers A/B/G: 100% pass
2. Layer D live: expected status match
3. Layer D artifacts must include per-scenario evidence files
4. Layer F live: >= 80% matrix pass
5. artifact structure validator passes
6. Layer H: 100% pass

## 4. Recommended Run Order

```bash
cd runtime
npm install
npx playwright install chromium
cp .env.example .env
npm run test:automation:full
npm run test:e2e:assistantless:contract
npm run test:e2e:assistantless:live
npm run test:e2e:autonomous:live
npm run test:provider:contract
npm run test:e2e:kr
npm run test:e2e:kr:headful
npm run test:evolution
npm run test:sdk
# if live provider credentials exist:
npm run test:e2e:provider:live
cd ..
./scripts/validate-run-artifacts.sh
```
