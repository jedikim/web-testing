import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  createBackendSimpleHttpServer,
  type BackendSimpleHttpServerOptions
} from '../src/backend/simple-backend-server';
import { BackendSimpleService } from '../src/backend/simple-backend-service';
import { SessionStore } from '../src/session/store';

const serverRefs: Array<{ close: () => Promise<void> }> = [];

afterEach(async () => {
  while (serverRefs.length > 0) {
    const ref = serverRefs.pop();
    if (ref) {
      await ref.close();
    }
  }
});

async function startServer(options?: { uiDir?: string }) {
  const stateRoot = await mkdtemp(resolve(tmpdir(), 'backend-simple-state-'));
  const store = new SessionStore({
    rootDir: stateRoot
  });

  const service = new BackendSimpleService({
    store,
    engine: {
      async generate() {
        return {
          content: 'assistant reply'
        };
      }
    }
  });

  const uiDir = options?.uiDir ?? (await mkdtemp(resolve(tmpdir(), 'backend-simple-ui-')));
  await writeFile(resolve(uiDir, 'index.html'), '<!doctype html><title>backend-ui</title>', 'utf-8');
  await writeFile(resolve(uiDir, 'app.js'), 'console.log("backend-ui")', 'utf-8');

  const server = createBackendSimpleHttpServer({
    service,
    uiDir
  } as BackendSimpleHttpServerOptions);

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

describe('backend simple server', () => {
  it('serves health and session APIs', async () => {
    const { baseUrl } = await startServer();

    const health = await fetch(`${baseUrl}/health`);
    expect(health.status).toBe(200);

    const createdResponse = await fetch(`${baseUrl}/backend/sessions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        title: 'http test session',
        mode: 'backend_simple'
      })
    });

    expect(createdResponse.status).toBe(201);
    const created = (await createdResponse.json()) as {
      ok: boolean;
      data: { id: string };
    };

    const turnResponse = await fetch(
      `${baseUrl}/backend/sessions/${encodeURIComponent(created.data.id)}/turns`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          content: 'hello backend',
          screenshotPath: '/tmp/backend-shot.png'
        })
      }
    );

    expect(turnResponse.status).toBe(200);

    const sessionResponse = await fetch(
      `${baseUrl}/backend/sessions/${encodeURIComponent(created.data.id)}`
    );

    const sessionPayload = (await sessionResponse.json()) as {
      ok: boolean;
      data: { turns: Array<{ role: string }> };
    };

    expect(sessionPayload.ok).toBe(true);
    expect(sessionPayload.data.turns.length).toBe(2);
    expect(sessionPayload.data.turns[0]?.role).toBe('user');
    expect(sessionPayload.data.turns[1]?.role).toBe('assistant');

    const screenshotResponse = await fetch(
      `${baseUrl}/backend/sessions/${encodeURIComponent(created.data.id)}/screenshot`
    );
    expect(screenshotResponse.status).toBe(200);
    const screenshotPayload = (await screenshotResponse.json()) as {
      ok: boolean;
      data?: { path?: string; source?: string };
    };
    expect(screenshotPayload.ok).toBe(true);
    expect(screenshotPayload.data?.path).toBe('/tmp/backend-shot.png');
    expect(screenshotPayload.data?.source).toBe('turn_screenshot');

    const handoffsResponse = await fetch(
      `${baseUrl}/backend/sessions/${encodeURIComponent(created.data.id)}/handoffs`
    );
    expect(handoffsResponse.status).toBe(200);
    const handoffsPayload = (await handoffsResponse.json()) as {
      ok: boolean;
      data: unknown[];
    };
    expect(handoffsPayload.ok).toBe(true);
    expect(handoffsPayload.data).toEqual([]);

    const closeResponse = await fetch(
      `${baseUrl}/backend/sessions/${encodeURIComponent(created.data.id)}/close`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify({})
      }
    );

    expect(closeResponse.status).toBe(200);
  });

  it('maps session and validation errors to 404/400', async () => {
    const { baseUrl } = await startServer();

    const missing = await fetch(`${baseUrl}/backend/sessions/missing-session`);
    expect(missing.status).toBe(404);

    const createdResponse = await fetch(`${baseUrl}/backend/sessions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        title: 'validation session'
      })
    });

    const created = (await createdResponse.json()) as {
      data: { id: string };
    };

    const emptyTurn = await fetch(
      `${baseUrl}/backend/sessions/${encodeURIComponent(created.data.id)}/turns`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          content: '   '
        })
      }
    );

    expect(emptyTurn.status).toBe(400);
  });

  it('serves backend UI assets', async () => {
    const { baseUrl } = await startServer();

    const indexResponse = await fetch(`${baseUrl}/backend/ui`);
    expect(indexResponse.status).toBe(200);
    const indexHtml = await indexResponse.text();
    expect(indexHtml).toContain('<!doctype html>');

    const jsResponse = await fetch(`${baseUrl}/backend/ui/app.js`);
    expect(jsResponse.status).toBe(200);
    const jsBody = await jsResponse.text();
    expect(jsBody).toContain('backend-ui');
  });
});
