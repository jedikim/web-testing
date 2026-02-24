> Language: [English](./CODEX-PRACTICAL-USAGE.en.md) | [한국어](./CODEX-PRACTICAL-USAGE.md)

# CODEX PRACTICAL USAGE GUIDE

Last Updated: 2026-02-25 (KST)

## 0. Purpose

Show practical, operator-style usage for:
1. backend-simple mode
2. chat automation backend mode
3. SDK embedded mode

## 1. Practical Safety Baseline

1. keep browser headful for real validation (`PW_HEADLESS=0`)
2. capture screenshots at uncertain steps
3. stop and handoff on captcha/2FA/security challenges
4. keep outputs under gitignored `testing/`

## 2. Workflow Template for Real Tasks

Use this loop for tasks like:
- "check weather, then find kid-friendly places near Pangyo"
- "find items similar to this attached image"

Loop:
1. capture current state screenshot
2. analyze task and current page
3. execute deterministic step
4. verify outcome
5. if failed, run bounded recovery path
6. if blocked/security, request human handoff
7. continue until done

## 3. Chat Backend Practical Example

### 3.1 Start server

```bash
cd runtime
npm run example:chat-backend
```

### 3.2 Create session

```bash
curl -s http://127.0.0.1:4999/example/chat/sessions \
  -H 'content-type: application/json' \
  -d '{"title":"pangyo weather+map","operatorId":"operator-main"}'
```

### 3.3 Send goal message

```bash
curl -s http://127.0.0.1:4999/example/chat/sessions/<SESSION_ID>/message \
  -H 'content-type: application/json' \
  -d '{
    "content":"Check today weather and find kid-friendly places near Pangyo on Naver map.",
    "browserMode":"headful",
    "operatorId":"operator-main",
    "autoPauseOthers":true
  }'
```

### 3.4 Attach reference image

```bash
curl -s http://127.0.0.1:4999/example/chat/sessions/<SESSION_ID>/message \
  -H 'content-type: application/json' \
  -d '{
    "content":"Find visually similar products on Naver image search",
    "browserMode":"headful",
    "operatorId":"operator-main",
    "attachments":[
      {"name":"reference.png","dataUrl":"data:image/png;base64,<BASE64>"}
    ]
  }'
```

### 3.5 Observe live logs

```bash
curl -N http://127.0.0.1:4999/example/chat/sessions/<SESSION_ID>/stream
```

### 3.6 Human handoff for captcha

```bash
curl -s http://127.0.0.1:4999/example/chat/sessions/<SESSION_ID>/captcha \
  -H 'content-type: application/json' \
  -d '{"value":"A1B2C3"}'
```

## 4. SDK Practical Example

```ts
import { createWebAutomationSdk } from '../src/index';

const sdk = createWebAutomationSdk();
const result = await sdk.runWithImprovement({
  workflowId: 'wf-kr-practical',
  targetUrl: 'https://www.naver.com',
  objective: 'weather then family-friendly nearby places',
  run: async () => {
    return {
      status: 'fail',
      failures: [{ code: 'SelectorNotFound', message: 'search input changed' }]
    };
  }
});

console.log(result);
```

## 5. Operational Review Checklist

After each run, verify:
1. run status and step trace
2. screenshot/handoff evidence
3. failure classification and recovery action
4. whether evolution trigger was appropriate (bug/exception only)
5. no safety-policy violations

## 6. Where to Continue

1. [SDK + Backend Usage](./CODEX-SDK-BACKEND-USAGE.en.md)
2. [E2E Testing Guide](./CODEX-E2E-TESTING.en.md)
3. [Environment Setup](./CODEX-ENV-SETUP.en.md)
