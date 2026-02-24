import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createChatAutomationHttpServer } from '../src/backend/chat-automation-server';
import { ChatAutomationService } from '../src/backend/chat-automation-service';
import { SessionStore } from '../src/session/store';

const serverRefs: Array<{ close: () => Promise<void> }> = [];

function sleep(ms: number): Promise<void> {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, ms);
  });
}

afterEach(async () => {
  while (serverRefs.length > 0) {
    const ref = serverRefs.pop();
    if (ref) {
      await ref.close();
    }
  }
});

async function startServer() {
  const stateRoot = await mkdtemp(resolve(tmpdir(), 'chat-automation-state-'));
  const uiDir = await mkdtemp(resolve(tmpdir(), 'chat-automation-ui-'));

  await writeFile(resolve(uiDir, 'index.html'), '<!doctype html><title>chat-ui</title>', 'utf-8');
  await writeFile(resolve(uiDir, 'app.js'), 'console.log("chat-ui")', 'utf-8');
  await writeFile(resolve(uiDir, 'style.css'), 'body { color: black; }', 'utf-8');

  const store = new SessionStore({
    rootDir: stateRoot
  });
  const service = new ChatAutomationService({
    store,
    stepDelayMs: 15
  });
  await service.init();

  const server = createChatAutomationHttpServer({
    service,
    uiDir
  });

  await new Promise<void>((resolvePromise) => {
    server.listen(0, '127.0.0.1', () => resolvePromise());
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('failed to resolve address');
  }
  const baseUrl = `http://127.0.0.1:${address.port}`;

  serverRefs.push({
    close: async () => {
      await new Promise<void>((resolvePromise) => {
        server.close(() => resolvePromise());
      });
      await rm(stateRoot, { recursive: true, force: true });
      await rm(uiDir, { recursive: true, force: true });
    }
  });

  return {
    baseUrl
  };
}

async function waitForRunStatus(
  baseUrl: string,
  sessionId: string,
  statuses: string[],
  timeoutMs = 5000
): Promise<{ run: { status: string; waitingCaptcha?: boolean }; logs: Array<{ message: string }> }> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const response = await fetch(`${baseUrl}/example/chat/sessions/${encodeURIComponent(sessionId)}`);
    const payload = (await response.json()) as {
      ok: boolean;
      data: { run: { status: string; waitingCaptcha?: boolean }; logs: Array<{ message: string }> };
    };
    if (statuses.includes(payload.data.run.status)) {
      return payload.data;
    }
    await sleep(25);
  }
  throw new Error(`timeout waiting for run status: ${statuses.join(',')}`);
}

describe('chat automation server', () => {
  it('serves chat UI assets and health', async () => {
    const { baseUrl } = await startServer();

    const health = await fetch(`${baseUrl}/example/chat/health`);
    expect(health.status).toBe(200);
    const healthBody = (await health.json()) as { ok: boolean; data: { status: string } };
    expect(healthBody.ok).toBe(true);
    expect(healthBody.data.status).toBe('up');

    const index = await fetch(`${baseUrl}/example/chat/ui`);
    expect(index.status).toBe(200);
    expect(await index.text()).toContain('<!doctype html>');

    const script = await fetch(`${baseUrl}/example/chat/ui/app.js`);
    expect(script.status).toBe(200);
    expect(await script.text()).toContain('chat-ui');
  });

  it('handles message run lifecycle with pause/resume/captcha endpoints', async () => {
    const { baseUrl } = await startServer();

    const createdResponse = await fetch(`${baseUrl}/example/chat/sessions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        title: 'captcha lifecycle',
        operatorId: 'operator-1'
      })
    });
    expect(createdResponse.status).toBe(201);
    const created = (await createdResponse.json()) as {
      ok: boolean;
      data: { session: { id: string } };
    };
    const sessionId = created.data.session.id;

    const sendResponse = await fetch(
      `${baseUrl}/example/chat/sessions/${encodeURIComponent(sessionId)}/message`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          content: 'Login flow requires captcha verification.',
          browserMode: 'headful',
          operatorId: 'operator-1',
          autoPauseOthers: true
        })
      }
    );
    expect(sendResponse.status).toBe(200);

    await waitForRunStatus(baseUrl, sessionId, ['waiting_captcha']);

    const pauseResponse = await fetch(
      `${baseUrl}/example/chat/sessions/${encodeURIComponent(sessionId)}/pause`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify({})
      }
    );
    expect(pauseResponse.status).toBe(200);
    const paused = await waitForRunStatus(baseUrl, sessionId, ['paused']);
    expect(paused.run.status).toBe('paused');

    const resumeResponse = await fetch(
      `${baseUrl}/example/chat/sessions/${encodeURIComponent(sessionId)}/resume`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify({})
      }
    );
    expect(resumeResponse.status).toBe(200);
    await waitForRunStatus(baseUrl, sessionId, ['waiting_captcha']);

    const captchaResponse = await fetch(
      `${baseUrl}/example/chat/sessions/${encodeURIComponent(sessionId)}/captcha`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          value: 'A1B2C3'
        })
      }
    );
    expect(captchaResponse.status).toBe(200);

    const completed = await waitForRunStatus(baseUrl, sessionId, ['completed']);
    expect(completed.run.status).toBe('completed');
    expect(completed.logs.some((entry) => entry.message.includes('Captcha submitted by user'))).toBe(true);
  });

  it('streams live snapshot events over SSE and validates malformed input', async () => {
    const { baseUrl } = await startServer();

    const createdResponse = await fetch(`${baseUrl}/example/chat/sessions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        title: 'stream session',
        operatorId: 'operator-2'
      })
    });
    const created = (await createdResponse.json()) as {
      data: { session: { id: string } };
    };
    const sessionId = created.data.session.id;

    const abortController = new AbortController();
    const streamResponse = await fetch(
      `${baseUrl}/example/chat/sessions/${encodeURIComponent(sessionId)}/stream`,
      {
        signal: abortController.signal
      }
    );
    expect(streamResponse.status).toBe(200);
    expect(streamResponse.headers.get('content-type')).toContain('text/event-stream');

    const reader = streamResponse.body?.getReader();
    expect(reader).toBeTruthy();
    const decoder = new TextDecoder();
    const firstChunk = await reader!.read();
    const chunkText = decoder.decode(firstChunk.value ?? new Uint8Array());
    expect(chunkText).toContain('event: snapshot');
    abortController.abort();

    const invalidJson = await fetch(`${baseUrl}/example/chat/sessions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: '{"title":'
    });
    expect(invalidJson.status).toBe(400);
  });
});
