import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { startChatAutomationServer } from '../src/backend/chat-automation-server';

interface RunningHarness {
  baseUrl: string;
  uiUrl: string;
  stateRoot: string;
  evidenceDir: string;
  sampleImagePath: string;
  close: () => Promise<void>;
}

interface TestTrace {
  name: string;
  startedAt: string;
  events: string[];
  screenshots: string[];
}

const TEST_DIR = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = resolve(TEST_DIR, '..', '..');
const WORKTREE_MARKER = '/.worktrees/';
const PROJECT_ROOT = REPO_ROOT.includes(WORKTREE_MARKER)
  ? REPO_ROOT.slice(0, REPO_ROOT.indexOf(WORKTREE_MARKER))
  : REPO_ROOT;
const CHAT_UI_E2E_ROOT = resolve(PROJECT_ROOT, 'testing', 'chat-ui-e2e');
const activeHarnesses: RunningHarness[] = [];

function nowIso(): string {
  return new Date().toISOString();
}

function sanitizeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '-');
}

async function poll(
  condition: () => Promise<boolean>,
  timeoutMs = 20000,
  intervalMs = 200
): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await condition()) {
      return;
    }
    await new Promise((resolvePromise) => {
      setTimeout(resolvePromise, intervalMs);
    });
  }
  throw new Error(`poll timeout after ${timeoutMs}ms`);
}

async function startHarness(testName: string): Promise<RunningHarness> {
  const stateRoot = await mkdtemp(resolve(tmpdir(), 'chat-ui-e2e-state-'));
  const runStamp = nowIso().replace(/[:.]/g, '-');
  const evidenceDir = resolve(CHAT_UI_E2E_ROOT, `${runStamp}_${sanitizeName(testName)}`);
  await mkdir(evidenceDir, { recursive: true });
  const sampleImagePath = resolve(stateRoot, 'sample-reference.png');
  await writeFile(
    sampleImagePath,
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAukB9Wn1JvQAAAAASUVORK5CYII=',
      'base64'
    )
  );

  const started = await startChatAutomationServer({
    host: '127.0.0.1',
    port: 0,
    sessionRoot: stateRoot,
    uiDir: resolve(REPO_ROOT, 'runtime', 'examples', 'chat-automation-ui'),
    stepDelayMs: 200
  });

  const address = started.server.address();
  if (!address || typeof address === 'string') {
    throw new Error('failed to resolve chat automation server address');
  }

  const baseUrl = `http://127.0.0.1:${address.port}`;
  const harness: RunningHarness = {
    baseUrl,
    uiUrl: `${baseUrl}/example/chat/ui`,
    stateRoot,
    evidenceDir,
    sampleImagePath,
    close: async () => {
      await new Promise<void>((resolvePromise) => {
        started.server.close(() => resolvePromise());
      });
      await rm(stateRoot, { recursive: true, force: true });
    }
  };
  activeHarnesses.push(harness);
  return harness;
}

async function writeTrace(harness: RunningHarness, trace: TestTrace): Promise<void> {
  const timeline = ['# Process', '', '| time | event |', '|---|---|'];
  for (const row of trace.events) {
    timeline.push(`| ${nowIso()} | ${row.replaceAll('|', '\\|')} |`);
  }

  await writeFile(join(harness.evidenceDir, 'process.md'), `${timeline.join('\n')}\n`, 'utf-8');
  await writeFile(
    join(harness.evidenceDir, 'result.json'),
    JSON.stringify(
      {
        name: trace.name,
        startedAt: trace.startedAt,
        finishedAt: nowIso(),
        screenshots: trace.screenshots,
        events: trace.events
      },
      null,
      2
    ),
    'utf-8'
  );
}

async function captureStep(
  page: import('playwright').Page,
  harness: RunningHarness,
  trace: TestTrace,
  label: string
): Promise<void> {
  const path = join(
    harness.evidenceDir,
    `${String(trace.screenshots.length + 1).padStart(2, '0')}-${sanitizeName(label)}.png`
  );
  try {
    await page.screenshot({ path, fullPage: true });
    trace.screenshots.push(path);
    trace.events.push(`screenshot: ${label}`);
    return;
  } catch {
    try {
      await page.screenshot({ path });
      trace.screenshots.push(path);
      trace.events.push(`screenshot(fallback): ${label}`);
      return;
    } catch (error) {
      trace.events.push(
        `screenshot skipped: ${label} (${error instanceof Error ? error.message : String(error)})`
      );
    }
  }
}

async function createSessionViaApi(
  harness: RunningHarness,
  title: string,
  operatorId: string,
  trace: TestTrace
): Promise<string> {
  const response = await fetch(`${harness.baseUrl}/example/chat/sessions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      title,
      operatorId
    })
  });
  expect(response.ok).toBe(true);
  const payload = (await response.json()) as {
    ok: boolean;
    data: { session: { id: string } };
  };
  expect(payload.ok).toBe(true);
  trace.events.push(`session seeded via api: ${title}`);
  return payload.data.session.id;
}

async function selectSession(page: import('playwright').Page, title: string, trace: TestTrace): Promise<void> {
  const sessionItem = page.locator('.session-item', { hasText: title }).first();
  await sessionItem.click();
  await poll(async () => {
    const currentTitle = (await page.locator('#sessionTitle').textContent())?.trim();
    return currentTitle === title;
  }, 10000);
  trace.events.push(`session selected: ${title}`);
}

async function readStatus(page: import('playwright').Page): Promise<string> {
  return ((await page.locator('#statusBadge').textContent()) ?? '').trim();
}

async function waitForStatus(
  page: import('playwright').Page,
  wanted: string,
  trace: TestTrace,
  timeoutMs = 40000
): Promise<void> {
  await poll(async () => (await readStatus(page)) === wanted, timeoutMs, 250);
  trace.events.push(`status reached: ${wanted}`);
}

async function sendMessage(
  page: import('playwright').Page,
  message: string,
  browserMode: 'headful' | 'headless',
  trace: TestTrace,
  attachmentPaths: string[] = []
): Promise<void> {
  if (attachmentPaths.length > 0) {
    await page.setInputFiles('#attachmentInput', attachmentPaths);
    trace.events.push(`attachments selected: ${attachmentPaths.map((path) => path.split('/').pop()).join(', ')}`);
  }
  await page.locator('#browserModeSelect').selectOption(browserMode);
  await page.locator('#messageInput').fill(message);
  await page.locator('#sendBtn').click();
  trace.events.push(`message sent (${browserMode}): ${message.slice(0, 80)}`);
}

afterEach(async () => {
  while (activeHarnesses.length > 0) {
    const harness = activeHarnesses.pop();
    if (harness) {
      await harness.close();
    }
  }
});

describe('chat automation UI e2e', () => {
  it(
    'completes captcha handoff flow with live logs',
    async () => {
      const harness = await startHarness('captcha-handoff');
      const { chromium } = await import('playwright');
      const browser = await chromium.launch({
        headless: process.env.PW_HEADLESS !== '0'
      });
      const trace: TestTrace = {
        name: 'captcha-handoff',
        startedAt: nowIso(),
        events: [],
        screenshots: []
      };

      try {
        const context = await browser.newContext({
          locale: 'ko-KR',
          timezoneId: 'Asia/Seoul'
        });
        const page = await context.newPage();

        const response = await page.goto(harness.uiUrl, { waitUntil: 'domcontentloaded' });
        expect(response?.ok()).toBe(true);
        await page.locator('#operatorInput').fill('operator-chat-ui');
        await captureStep(page, harness, trace, 'opened-ui');

        await createSessionViaApi(harness, 'captcha-flow-session', 'operator-chat-ui', trace);
        await poll(async () => {
          return (await page.locator('.session-item', { hasText: 'captcha-flow-session' }).count()) > 0;
        }, 12000);
        await selectSession(page, 'captcha-flow-session', trace);
        await captureStep(page, harness, trace, 'session-created');

        await sendMessage(
          page,
          '첨부한 사진과 비슷한 것을 네이버에서 찾아주고, 로그인 과정에서 captcha verification 이 필요하면 사용자 입력을 기다려.',
          'headful',
          trace,
          [harness.sampleImagePath]
        );
        await waitForStatus(page, 'waiting_captcha', trace);
        await captureStep(page, harness, trace, 'waiting-captcha');

        await page.locator('#captchaInput').fill('A1B2C3');
        await page.locator('#submitCaptchaBtn').click();
        trace.events.push('captcha submitted in ui');

        await waitForStatus(page, 'completed', trace);
        await captureStep(page, harness, trace, 'completed');

        const logs = (await page.locator('#logs').textContent()) ?? '';
        const turns = (await page.locator('#turns').textContent()) ?? '';
        expect(turns).toContain('sample-reference.png');
        expect(logs).toContain('Attachment-aware flow enabled');
        expect(logs).toContain('Captcha input required from user');
        expect(logs).toContain('Run completed successfully');

        await context.close();
        await writeTrace(harness, trace);
      } finally {
        await browser.close();
      }
    },
    120000
  );

  it(
    'auto-pauses previous session when a new conversation starts',
    async () => {
      const harness = await startHarness('auto-pause-on-new-conversation');
      const { chromium } = await import('playwright');
      const browser = await chromium.launch({
        headless: process.env.PW_HEADLESS !== '0'
      });
      const trace: TestTrace = {
        name: 'auto-pause-on-new-conversation',
        startedAt: nowIso(),
        events: [],
        screenshots: []
      };

      try {
        const context = await browser.newContext({
          locale: 'ko-KR',
          timezoneId: 'Asia/Seoul'
        });
        const page = await context.newPage();
        const response = await page.goto(harness.uiUrl, { waitUntil: 'domcontentloaded' });
        expect(response?.ok()).toBe(true);
        await page.locator('#operatorInput').fill('operator-shared');
        await captureStep(page, harness, trace, 'opened-ui');

        await createSessionViaApi(harness, 'session-a', 'operator-shared', trace);
        await createSessionViaApi(harness, 'session-b', 'operator-shared', trace);
        await poll(async () => {
          const count = await page.locator('.session-item').count();
          return count >= 2;
        }, 12000);
        await captureStep(page, harness, trace, 'sessions-created');

        await selectSession(page, 'session-a', trace);
        await sendMessage(
          page,
          '첫 번째 세션 실행. login verification 이 필요하면 captcha 대기해.',
          'headful',
          trace
        );
        await waitForStatus(page, 'waiting_captcha', trace);
        await captureStep(page, harness, trace, 'session-a-waiting');

        await selectSession(page, 'session-b', trace);
        await sendMessage(page, '두 번째 세션 실행. 빠르게 완료해.', 'headless', trace);
        await waitForStatus(page, 'completed', trace);
        await captureStep(page, harness, trace, 'session-b-completed');

        await selectSession(page, 'session-a', trace);
        await waitForStatus(page, 'paused', trace);
        await captureStep(page, harness, trace, 'session-a-paused');

        const logs = (await page.locator('#logs').textContent()) ?? '';
        expect(logs).toContain('Paused because operator switched to session');

        await context.close();
        await writeTrace(harness, trace);
      } finally {
        await browser.close();
      }
    },
    120000
  );
});
