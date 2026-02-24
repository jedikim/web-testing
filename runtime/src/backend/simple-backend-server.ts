import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadEnvFiles } from '../config/load-env-file';
import { buildDefaultTurnEngine } from '../session/engine';
import { SessionStore } from '../session/store';

import { BackendSimpleService } from './simple-backend-service';

interface JsonResponse {
  ok: boolean;
  data?: unknown;
  error?: string;
}

export interface BackendSimpleHttpServerOptions {
  service: BackendSimpleService;
  uiDir?: string;
}

function contentType(path: string): string {
  const ext = extname(path);
  switch (ext) {
    case '.html':
      return 'text/html; charset=utf-8';
    case '.js':
      return 'text/javascript; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.svg':
      return 'image/svg+xml';
    case '.png':
      return 'image/png';
    default:
      return 'text/plain; charset=utf-8';
  }
}

function sendJson(res: ServerResponse, code: number, payload: JsonResponse): void {
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8'
  });
  res.end(`${JSON.stringify(payload, null, 2)}\n`);
}

async function parseBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    chunks.push(buffer);
    size += buffer.byteLength;
    if (size > 2 * 1024 * 1024) {
      throw new Error('request body too large');
    }
  }

  if (chunks.length === 0) {
    return undefined;
  }

  const raw = Buffer.concat(chunks).toString('utf-8').trim();
  if (raw.length === 0) {
    return undefined;
  }

  return JSON.parse(raw) as unknown;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function asStringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const rows = value
    .map((entry) => String(entry).trim())
    .filter((entry) => entry.length > 0);

  return rows.length > 0 ? rows : undefined;
}

function sanitizeRelativePath(pathname: string): string {
  return pathname.replace(/^\/+/, '').replace(/\.\.+/g, '');
}

function statusCodeForError(error: Error): number {
  if (error.message.startsWith('session not found:')) {
    return 404;
  }

  if (error.message.includes('must not be empty')) {
    return 400;
  }

  if (error.message.includes('request body too large')) {
    return 413;
  }

  return 500;
}

export function createBackendSimpleHttpServer(options: BackendSimpleHttpServerOptions) {
  const uiDir = options.uiDir ?? resolve(process.cwd(), 'runtime', 'backend-ui');

  return createServer(async (req, res) => {
    try {
      const method = req.method ?? 'GET';
      const url = new URL(req.url ?? '/', 'http://localhost');
      const path = url.pathname;

      if (method === 'GET' && path === '/health') {
        sendJson(res, 200, {
          ok: true,
          data: {
            status: 'up',
            mode: 'backend_simple'
          }
        });
        return;
      }

      if (method === 'GET' && path === '/backend/sessions') {
        const sessions = await options.service.listSessions();
        sendJson(res, 200, {
          ok: true,
          data: sessions
        });
        return;
      }

      if (method === 'POST' && path === '/backend/sessions') {
        const body = asRecord(await parseBody(req));
        const created = await options.service.createSession({
          mode: body.mode === 'sdk_detailed' ? 'sdk_detailed' : 'backend_simple',
          workflowId: body.workflowId ? String(body.workflowId) : undefined,
          title: body.title ? String(body.title) : undefined,
          tags: asStringList(body.tags),
          metadata: asRecord(body.metadata),
          systemPrompt: body.systemPrompt ? String(body.systemPrompt) : undefined
        });

        sendJson(res, 201, {
          ok: true,
          data: created
        });
        return;
      }

      const sessionMatch = path.match(/^\/backend\/sessions\/([^/]+)$/);
      if (method === 'GET' && sessionMatch) {
        const session = await options.service.getSession(sessionMatch[1]!);
        sendJson(res, 200, {
          ok: true,
          data: session
        });
        return;
      }

      const turnMatch = path.match(/^\/backend\/sessions\/([^/]+)\/turns$/);
      if (method === 'POST' && turnMatch) {
        const body = asRecord(await parseBody(req));
        const result = await options.service.sendUserTurn({
          sessionId: turnMatch[1]!,
          content: String(body.content ?? ''),
          screenshotPath: body.screenshotPath ? String(body.screenshotPath) : undefined,
          metadata: asRecord(body.metadata)
        });

        sendJson(res, 200, {
          ok: true,
          data: result
        });
        return;
      }

      const closeMatch = path.match(/^\/backend\/sessions\/([^/]+)\/close$/);
      if (method === 'POST' && closeMatch) {
        const closed = await options.service.closeSession(closeMatch[1]!);
        sendJson(res, 200, {
          ok: true,
          data: closed
        });
        return;
      }

      const streamMatch = path.match(/^\/backend\/sessions\/([^/]+)\/stream$/);
      if (method === 'GET' && streamMatch) {
        const sessionId = streamMatch[1]!;

        const initial = await options.service.getSession(sessionId);

        res.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-cache, no-transform',
          connection: 'keep-alive'
        });

        res.write('event: snapshot\n');
        res.write(`data: ${JSON.stringify(initial)}\n\n`);

        const unsubscribe = options.service.onSessionUpdate(sessionId, (snapshot) => {
          res.write('event: snapshot\n');
          res.write(`data: ${JSON.stringify(snapshot)}\n\n`);
        });

        const keepAlive = setInterval(() => {
          res.write(': keep-alive\n\n');
        }, 20000);

        req.on('close', () => {
          clearInterval(keepAlive);
          unsubscribe();
        });

        return;
      }

      if (method === 'GET' && (path === '/backend/ui' || path === '/backend/ui/')) {
        const indexPath = resolve(uiDir, 'index.html');
        const content = await readFile(indexPath);
        res.writeHead(200, {
          'content-type': contentType(indexPath)
        });
        res.end(content);
        return;
      }

      if (method === 'GET' && path.startsWith('/backend/ui/')) {
        const relative = sanitizeRelativePath(path.slice('/backend/ui/'.length));
        const filePath = resolve(uiDir, relative);
        const content = await readFile(filePath);
        res.writeHead(200, {
          'content-type': contentType(filePath)
        });
        res.end(content);
        return;
      }

      sendJson(res, 404, {
        ok: false,
        error: `route not found: ${method} ${path}`
      });
    } catch (error) {
      const typed = error as Error;
      sendJson(res, statusCodeForError(typed), {
        ok: false,
        error: typed.message
      });
    }
  });
}

export interface CreateBackendSimpleServiceOptions {
  sessionRoot: string;
}

export function createBackendSimpleServiceFromEnv(
  options: CreateBackendSimpleServiceOptions
): BackendSimpleService {
  const store = new SessionStore({
    rootDir: options.sessionRoot
  });

  return new BackendSimpleService({
    store,
    engine: buildDefaultTurnEngine({
      useGemini: process.env.BACKEND_LLM_ENABLED === '1'
    })
  });
}

export interface StartBackendSimpleServerOptions {
  host?: string;
  port?: number;
  repoRoot?: string;
  sessionRoot?: string;
  uiDir?: string;
}

export function startBackendSimpleServer(options: StartBackendSimpleServerOptions = {}) {
  const sourceDir = dirname(fileURLToPath(import.meta.url));
  const runtimeRoot = resolve(sourceDir, '..', '..');
  const repoRoot = options.repoRoot ?? resolve(runtimeRoot, '..');

  const sessionRoot =
    options.sessionRoot ??
    process.env.BACKEND_SESSION_ROOT ??
    resolve(repoRoot, 'testing', 'backend', 'state');

  const service = createBackendSimpleServiceFromEnv({
    sessionRoot
  });

  const server = createBackendSimpleHttpServer({
    service,
    uiDir: options.uiDir ?? resolve(runtimeRoot, 'backend-ui')
  });

  const host = options.host ?? process.env.BACKEND_SERVER_HOST ?? '127.0.0.1';
  const port =
    options.port ??
    (process.env.BACKEND_SERVER_PORT ? Number(process.env.BACKEND_SERVER_PORT) : 4888);

  server.listen(port, host, () => {
    // eslint-disable-next-line no-console
    console.log(`[backend-simple-server] listening on http://${host}:${port}`);
  });

  return {
    server,
    service
  };
}

const isMain =
  process.argv[1] != null && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const sourceDir = dirname(fileURLToPath(import.meta.url));
  const runtimeRoot = resolve(sourceDir, '..', '..');
  const repoRoot = resolve(runtimeRoot, '..');
  loadEnvFiles({ cwd: repoRoot, filenames: ['runtime/.env', '.env'] });
  startBackendSimpleServer();
}
