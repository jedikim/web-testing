import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadEnvFiles } from '../config/load-env-file';
import { SessionStore } from '../session/store';

import {
  ChatAutomationService,
  type BrowserMode,
  type ChatMessageAttachmentInput,
  type CreateChatSessionInput
} from './chat-automation-service';

interface JsonResponse {
  ok: boolean;
  data?: unknown;
  error?: string;
}

export interface ChatAutomationHttpServerOptions {
  service: ChatAutomationService;
  uiDir?: string;
  uploadDir?: string;
}

interface RawAttachmentPayload {
  name?: unknown;
  mimeType?: unknown;
  url?: unknown;
  path?: unknown;
  dataUrl?: unknown;
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
    default:
      return 'text/plain; charset=utf-8';
  }
}

function sendJson(res: ServerResponse, statusCode: number, payload: JsonResponse): void {
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8'
  });
  res.end(`${JSON.stringify(payload, null, 2)}\n`);
}

async function parseBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  const maxSizeBytes = 15 * 1024 * 1024;

  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    chunks.push(buffer);
    size += buffer.byteLength;

    if (size > maxSizeBytes) {
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

function asBrowserMode(value: unknown): BrowserMode {
  return value === 'headful' ? 'headful' : 'headless';
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  return fallback;
}

function sanitizeRelativePath(pathname: string): string {
  return pathname.replace(/^\/+/, '').replace(/\.\.+/g, '').replace(/\\/g, '/');
}

function sanitizeFilename(raw: string): string {
  const value = raw.replace(/[^a-zA-Z0-9._-]/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '');
  return value.length > 0 ? value : 'attachment';
}

function extensionFromMime(mimeType: string | undefined): string {
  if (!mimeType) {
    return '.bin';
  }
  const normalized = mimeType.toLowerCase();
  if (normalized.includes('png')) {
    return '.png';
  }
  if (normalized.includes('jpeg') || normalized.includes('jpg')) {
    return '.jpg';
  }
  if (normalized.includes('webp')) {
    return '.webp';
  }
  if (normalized.includes('gif')) {
    return '.gif';
  }
  return '.bin';
}

function parseDataUrl(raw: string): { mimeType?: string; buffer: Buffer } {
  const matched = raw.match(/^data:([^;,]+)?;base64,(.+)$/);
  if (!matched) {
    throw new Error('invalid attachment dataUrl');
  }
  const mimeType = matched[1] ? matched[1].trim() : undefined;
  const encoded = matched[2]!.trim();
  if (encoded.length === 0) {
    throw new Error('invalid attachment dataUrl');
  }
  return {
    mimeType,
    buffer: Buffer.from(encoded, 'base64')
  };
}

function asRawAttachmentList(value: unknown): RawAttachmentPayload[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((entry) => typeof entry === 'object' && entry !== null && !Array.isArray(entry))
    .map((entry) => entry as RawAttachmentPayload);
}

async function resolveMessageAttachments(
  sessionId: string,
  attachments: RawAttachmentPayload[],
  uploadRoot: string
): Promise<ChatMessageAttachmentInput[]> {
  if (attachments.length === 0) {
    return [];
  }
  if (attachments.length > 8) {
    throw new Error('attachments exceed limit (max 8)');
  }

  const targetDir = resolve(uploadRoot, sanitizeFilename(sessionId));
  await mkdir(targetDir, { recursive: true });

  const resolved: ChatMessageAttachmentInput[] = [];

  for (let index = 0; index < attachments.length; index += 1) {
    const entry = attachments[index]!;
    const name = entry.name ? String(entry.name).trim() : `attachment-${index + 1}`;
    const mimeType = entry.mimeType ? String(entry.mimeType).trim() : undefined;
    const url = entry.url ? String(entry.url).trim() : '';
    const path = entry.path ? String(entry.path).trim() : '';
    const dataUrl = entry.dataUrl ? String(entry.dataUrl).trim() : '';

    if (url.length > 0) {
      resolved.push({
        name,
        mimeType,
        source: 'url',
        url
      });
      continue;
    }

    if (path.length > 0) {
      resolved.push({
        name,
        mimeType,
        source: 'path',
        path
      });
      continue;
    }

    if (dataUrl.length > 0) {
      const parsed = parseDataUrl(dataUrl);
      const sizeBytes = parsed.buffer.byteLength;
      if (sizeBytes > 8 * 1024 * 1024) {
        throw new Error('attachment too large (max 8MB each)');
      }

      const extension = extname(name) || extensionFromMime(parsed.mimeType ?? mimeType);
      const stem = extname(name) ? name.slice(0, -extname(name).length) : name;
      const filename = `${Date.now()}-${index + 1}-${sanitizeFilename(stem)}${extension.startsWith('.') ? extension : `.${extension}`}`;
      const absolutePath = resolve(targetDir, filename);
      if (!absolutePath.startsWith(`${targetDir}/`) && absolutePath !== targetDir) {
        throw new Error('invalid attachment path');
      }
      await writeFile(absolutePath, parsed.buffer);
      resolved.push({
        name,
        mimeType: parsed.mimeType ?? mimeType,
        source: 'upload',
        path: absolutePath,
        sizeBytes
      });
    }
  }

  return resolved;
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

  if (error.message.includes('invalid json')) {
    return 400;
  }

  if (error.message.includes('attachment')) {
    return 400;
  }

  return 500;
}

export function createChatAutomationHttpServer(options: ChatAutomationHttpServerOptions) {
  const uiDir = options.uiDir ?? resolve(process.cwd(), 'runtime', 'examples', 'chat-automation-ui');
  const uploadDir = options.uploadDir ?? resolve(process.cwd(), 'testing', 'chat-automation', 'uploads');

  return createServer(async (req, res) => {
    try {
      const method = req.method ?? 'GET';
      const url = new URL(req.url ?? '/', 'http://localhost');
      const path = url.pathname;

      if (method === 'GET' && path === '/example/chat/health') {
        sendJson(res, 200, {
          ok: true,
          data: {
            status: 'up',
            mode: 'chat_automation_example'
          }
        });
        return;
      }

      if (method === 'GET' && path === '/example/chat/sessions') {
        const sessions = await options.service.listSessions();
        sendJson(res, 200, {
          ok: true,
          data: sessions
        });
        return;
      }

      if (method === 'POST' && path === '/example/chat/sessions') {
        const body = asRecord(await parseBody(req));
        const created = await options.service.createSession({
          title: body.title ? String(body.title) : undefined,
          workflowId: body.workflowId ? String(body.workflowId) : undefined,
          tags: asStringList(body.tags),
          operatorId: body.operatorId ? String(body.operatorId) : undefined,
          metadata: asRecord(body.metadata),
          systemPrompt: body.systemPrompt ? String(body.systemPrompt) : undefined
        } satisfies CreateChatSessionInput);

        sendJson(res, 201, {
          ok: true,
          data: created
        });
        return;
      }

      const sessionDetail = path.match(/^\/example\/chat\/sessions\/([^/]+)$/);
      if (method === 'GET' && sessionDetail) {
        const snapshot = await options.service.getSnapshot(sessionDetail[1]!);
        sendJson(res, 200, {
          ok: true,
          data: snapshot
        });
        return;
      }

      const messageRoute = path.match(/^\/example\/chat\/sessions\/([^/]+)\/message$/);
      if (method === 'POST' && messageRoute) {
        const body = asRecord(await parseBody(req));
        const attachments = await resolveMessageAttachments(
          messageRoute[1]!,
          asRawAttachmentList(body.attachments),
          uploadDir
        );

        const snapshot = await options.service.sendMessage({
          sessionId: messageRoute[1]!,
          content: String(body.content ?? ''),
          browserMode: asBrowserMode(body.browserMode),
          operatorId: body.operatorId ? String(body.operatorId) : undefined,
          autoPauseOthers: asBoolean(body.autoPauseOthers, true),
          attachments
        });

        sendJson(res, 200, {
          ok: true,
          data: snapshot
        });
        return;
      }

      const pauseRoute = path.match(/^\/example\/chat\/sessions\/([^/]+)\/pause$/);
      if (method === 'POST' && pauseRoute) {
        const snapshot = await options.service.pauseSession(pauseRoute[1]!);
        sendJson(res, 200, { ok: true, data: snapshot });
        return;
      }

      const resumeRoute = path.match(/^\/example\/chat\/sessions\/([^/]+)\/resume$/);
      if (method === 'POST' && resumeRoute) {
        const snapshot = await options.service.resumeSession(resumeRoute[1]!);
        sendJson(res, 200, { ok: true, data: snapshot });
        return;
      }

      const cancelRoute = path.match(/^\/example\/chat\/sessions\/([^/]+)\/cancel$/);
      if (method === 'POST' && cancelRoute) {
        const snapshot = await options.service.cancelSession(cancelRoute[1]!);
        sendJson(res, 200, { ok: true, data: snapshot });
        return;
      }

      const captchaRoute = path.match(/^\/example\/chat\/sessions\/([^/]+)\/captcha$/);
      if (method === 'POST' && captchaRoute) {
        const body = asRecord(await parseBody(req));
        const snapshot = await options.service.submitCaptcha({
          sessionId: captchaRoute[1]!,
          value: String(body.value ?? '')
        });
        sendJson(res, 200, { ok: true, data: snapshot });
        return;
      }

      const streamRoute = path.match(/^\/example\/chat\/sessions\/([^/]+)\/stream$/);
      if (method === 'GET' && streamRoute) {
        const sessionId = streamRoute[1]!;

        const initial = await options.service.getSnapshot(sessionId);

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

      if (method === 'GET' && (path === '/example/chat/ui' || path === '/example/chat/ui/')) {
        const indexPath = resolve(uiDir, 'index.html');
        const content = await readFile(indexPath);
        res.writeHead(200, {
          'content-type': contentType(indexPath)
        });
        res.end(content);
        return;
      }

      if (method === 'GET' && path.startsWith('/example/chat/ui/')) {
        const relative = sanitizeRelativePath(path.slice('/example/chat/ui/'.length));
        const filePath = resolve(uiDir, relative);
        const normalizedUiRoot = resolve(uiDir);
        if (filePath !== normalizedUiRoot && !filePath.startsWith(`${normalizedUiRoot}/`)) {
          sendJson(res, 404, {
            ok: false,
            error: `route not found: ${method} ${path}`
          });
          return;
        }
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
      const typed =
        error instanceof SyntaxError ? new Error('invalid json payload') : (error as Error);
      sendJson(res, statusCodeForError(typed), {
        ok: false,
        error: typed.message
      });
    }
  });
}

export interface StartChatAutomationServerOptions {
  host?: string;
  port?: number;
  repoRoot?: string;
  sessionRoot?: string;
  uiDir?: string;
  uploadDir?: string;
  stepDelayMs?: number;
}

export async function startChatAutomationServer(options: StartChatAutomationServerOptions = {}) {
  const sourceDir = dirname(fileURLToPath(import.meta.url));
  const runtimeRoot = resolve(sourceDir, '..', '..');
  const repoRoot = options.repoRoot ?? resolve(runtimeRoot, '..');

  const sessionRoot =
    options.sessionRoot ??
    process.env.CHAT_AUTOMATION_SESSION_ROOT ??
    resolve(repoRoot, 'testing', 'chat-automation', 'state');
  const uploadDir =
    options.uploadDir ??
    process.env.CHAT_AUTOMATION_UPLOAD_ROOT ??
    resolve(sessionRoot, 'uploads');

  const store = new SessionStore({
    rootDir: sessionRoot
  });

  const service = new ChatAutomationService({
    store,
    stepDelayMs: options.stepDelayMs
  });
  await service.init();

  const server = createChatAutomationHttpServer({
    service,
    uiDir: options.uiDir,
    uploadDir
  });

  const host = options.host ?? process.env.CHAT_AUTOMATION_SERVER_HOST ?? '127.0.0.1';
  const port =
    options.port ??
    (process.env.CHAT_AUTOMATION_SERVER_PORT
      ? Number(process.env.CHAT_AUTOMATION_SERVER_PORT)
      : 4999);

  await new Promise<void>((resolvePromise) => {
    server.listen(port, host, () => {
      // eslint-disable-next-line no-console
      console.log(`[chat-automation-server] listening on http://${host}:${port}`);
      resolvePromise();
    });
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
  void startChatAutomationServer();
}
