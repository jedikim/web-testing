import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { chromium } from 'playwright';

import { startChatAutomationServer } from './src/backend/chat-automation-server';
import { loadEnvFiles } from './src/config/load-env-file';

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitUntil(fn: () => Promise<boolean>, timeoutMs = 240000, intervalMs = 400): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await fn()) {
      return;
    }
    await sleep(intervalMs);
  }
  throw new Error(`timeout ${timeoutMs}ms`);
}

async function main(): Promise<void> {
  const repoRoot = '/home/jedi/code/web-agentic-codex';
  const runtimeRoot = resolve(repoRoot, 'runtime');
  const prompt =
    (process.env.CHAT_UI_TEST_PROMPT ?? '').trim() ||
    'danawa.com 에 가서 여성스포츠의류 에서 등산복 중에서 10만원 이하의 등산복중에서 붉은색 옷을 찾아줘 하나만';
  const scenarioTag = ((process.env.CHAT_UI_TEST_TAG ?? 'live') || 'live').trim().replace(/[^a-zA-Z0-9_-]+/g, '-');
  const runTimeoutMs = Number(process.env.CHAT_UI_TEST_TIMEOUT_MS ?? '360000');
  loadEnvFiles({
    cwd: repoRoot,
    filenames: ['runtime/.env', '.env']
  });
  const evidenceDir = resolve(
    repoRoot,
    'testing',
    'chat-ui-manual',
    `${new Date().toISOString().replace(/[:.]/g, '-')}_${scenarioTag}`
  );
  await mkdir(evidenceDir, { recursive: true });

  process.env.LLM_VENDOR_ORDER = 'gemini';
  process.env.CHAT_AUTOMATION_PLANNER_MODE = 'llm_first';
  process.env.CHAT_AUTOMATION_ALLOW_PRO_ESCALATION = '0';
  process.env.CHAT_AUTOMATION_MAX_PLANNER_ATTEMPTS = '4';
  process.env.CHAT_AUTOMATION_MAX_PLANNER_ACTIONS = '18';
  process.env.CHAT_AUTOMATION_VISUAL_REPEAT_ENABLED = '1';
  process.env.CHAT_AUTOMATION_VISUAL_TILE_LIMIT = '24';
  process.env.RFDETR_ENABLED = '1';

  const started = await startChatAutomationServer({
    host: '127.0.0.1',
    port: 0,
    repoRoot,
    sessionRoot: resolve(repoRoot, 'testing', 'chat-ui-manual', 'danawa-state'),
    uiDir: resolve(runtimeRoot, 'examples', 'chat-automation-ui'),
    executionMode: 'playwright',
    runtimeScreenshotRoot: resolve(repoRoot, 'testing', 'chat-ui-manual', 'runtime-shots'),
    stepDelayMs: 250
  });

  const address = started.server.address();
  if (!address || typeof address === 'string') {
    throw new Error('server address resolve failed');
  }
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const uiUrl = `${baseUrl}/example/chat/ui`;
  const sessionTitle = `${scenarioTag}-session-${Date.now()}`;

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
  const page = await context.newPage();

  try {
    await page.goto(uiUrl, { waitUntil: 'domcontentloaded' });
    await page.locator('#operatorInput').fill('operator-danawa-live');

    const createRes = await fetch(`${baseUrl}/example/chat/sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: sessionTitle, operatorId: 'operator-danawa-live' })
    });
    if (!createRes.ok) {
      throw new Error(`session create failed: ${createRes.status}`);
    }
    const createdPayload = (await createRes.json()) as {
      data?: {
        session?: {
          id?: string;
        };
      };
    };
    const sessionId = createdPayload.data?.session?.id;
    if (!sessionId) {
      throw new Error('session create payload missing session.id');
    }

    await waitUntil(async () => (await page.locator('.session-item', { hasText: sessionTitle }).count()) > 0, 15000, 200);
    await page.locator('.session-item', { hasText: sessionTitle }).first().click();

    await page.locator('#browserModeSelect').selectOption('headful');
    await page.locator('#messageInput').fill(prompt);
    await page.locator('#sendBtn').click();

    let timedOut = false;
    try {
      await waitUntil(async () => {
        const snapshotRes = await fetch(`${baseUrl}/example/chat/sessions/${sessionId}`);
        if (!snapshotRes.ok) {
          return false;
        }
        const snapshotPayload = (await snapshotRes.json()) as {
          data?: {
            run?: {
              status?: string;
            };
          };
        };
        const runStatus = (snapshotPayload.data?.run?.status ?? '').toLowerCase();
        return runStatus === 'completed' || runStatus === 'failed' || runStatus === 'canceled';
      }, Number.isFinite(runTimeoutMs) ? runTimeoutMs : 360000, 700);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/timeout/i.test(message)) {
        timedOut = true;
      } else {
        throw error;
      }
    }

    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitUntil(async () => (await page.locator('.session-item', { hasText: sessionTitle }).count()) > 0, 15000, 250);
    await page.locator('.session-item', { hasText: sessionTitle }).first().click();

    const status = ((await page.locator('#statusBadge').textContent()) ?? '').trim();
    const logs = ((await page.locator('#logs').textContent()) ?? '').slice(0, 20000);
    const turns = ((await page.locator('#turns').textContent()) ?? '').slice(0, 20000);

    await page.screenshot({ path: join(evidenceDir, 'chat-ui-final.png'), fullPage: true });
    await writeFile(
      join(evidenceDir, 'result.md'),
      [
        '# Live UI Test',
        '',
        `- baseUrl: ${baseUrl}`,
        `- uiUrl: ${uiUrl}`,
        `- prompt: ${prompt}`,
        `- timeoutMs: ${Number.isFinite(runTimeoutMs) ? runTimeoutMs : 360000}`,
        `- timedOut: ${timedOut}`,
        `- finalStatus: ${status}`,
        '',
        '## Checks',
        `- listing attempt 2+: ${/Listing strategy attempt 2\/4/i.test(logs)}`,
        `- search strategy added: ${/in-site search strategy auto-added|search-query-submit|fallback-search-submit|search_fallback|search fallback/i.test(logs)}`,
        `- hierarchy groups logged: ${/Hierarchy hint groups:/i.test(logs)}`,
        `- visual repeated-item logged: ${/Visual repeated-item analysis:/i.test(logs)}`,
        '',
        '## Logs (excerpt)',
        '```text',
        logs,
        '```',
        '',
        '## Turns (excerpt)',
        '```text',
        turns,
        '```'
      ].join('\n'),
      'utf-8'
    );

    console.log('UI_URL:', uiUrl);
    console.log('FINAL_STATUS:', status);
    console.log('TIMED_OUT:', timedOut);
    console.log('EVIDENCE_DIR:', evidenceDir);
    console.log('HAS_VISUAL_LOG:', /Visual repeated-item analysis:/i.test(logs));
    console.log('HAS_MULTI_ATTEMPT:', /Listing strategy attempt 2\/4/i.test(logs));
  } finally {
    await context.close();
    await browser.close();
    await new Promise<void>((resolveClose) => {
      started.server.close(() => resolveClose());
    });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
