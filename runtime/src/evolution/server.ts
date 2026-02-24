import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadEnvFiles } from '../config/load-env-file';
import type { RunFailure, RunStatus } from '../types';

import { AutoImprovementOrchestrator } from './auto-improvement-orchestrator';
import { EvolutionService } from './service';

interface JsonResponse {
  ok: boolean;
  error?: string;
  data?: unknown;
}

export interface EvolutionHttpServerOptions {
  service: EvolutionService;
  uiDir?: string;
}

function sendJson(res: ServerResponse, statusCode: number, payload: JsonResponse): void {
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8'
  });
  res.end(`${JSON.stringify(payload, null, 2)}\n`);
}

async function parseBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    const size = chunks.reduce((acc, value) => acc + value.byteLength, 0);
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

function asFailureList(raw: unknown): RunFailure[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .map((value) => asRecord(value))
    .map((row) => ({
      code: String(row.code ?? 'Unknown') as RunFailure['code'],
      message: String(row.message ?? 'unknown failure'),
      stepId: row.stepId ? String(row.stepId) : undefined,
      suggestedAction: row.suggestedAction ? String(row.suggestedAction) : undefined
    }));
}

function asStatus(raw: unknown): RunStatus {
  const value = String(raw ?? 'fail');
  if (value === 'pass' || value === 'blocked' || value === 'fail') {
    return value;
  }
  return 'fail';
}

function asTriggerStatuses(raw: unknown): RunStatus[] | undefined {
  if (!Array.isArray(raw)) {
    return undefined;
  }

  const statuses = raw
    .map((value) => String(value))
    .filter((value): value is RunStatus => value === 'pass' || value === 'fail' || value === 'blocked');

  return statuses.length > 0 ? statuses : undefined;
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

export function createEvolutionHttpServer(options: EvolutionHttpServerOptions) {
  const uiDir = options.uiDir ?? resolve(process.cwd(), 'runtime', 'evolution-ui');

  return createServer(async (req, res) => {
    try {
      const method = req.method ?? 'GET';
      const url = new URL(req.url ?? '/', 'http://localhost');
      const path = url.pathname;

      if (method === 'GET' && path === '/health') {
        sendJson(res, 200, {
          ok: true,
          data: {
            status: 'up'
          }
        });
        return;
      }

      if (method === 'GET' && path === '/evolution/jobs') {
        const jobs = await options.service.listJobs();
        sendJson(res, 200, {
          ok: true,
          data: jobs
        });
        return;
      }

      if (method === 'POST' && path === '/evolution/jobs') {
        const body = asRecord(await parseBody(req));
        const snapshot = await options.service.createJob({
          title: String(body.title ?? 'Untitled evolution job'),
          trigger: body.trigger === 'exception' ? 'exception' : 'bug',
          workflowId: String(body.workflowId ?? 'default-workflow'),
          sourceRunPath: body.sourceRunPath ? String(body.sourceRunPath) : undefined,
          notes: body.notes ? String(body.notes) : undefined,
          requestedBy: body.requestedBy ? String(body.requestedBy) : undefined,
          baseBranch: body.baseBranch ? String(body.baseBranch) : undefined,
          testCommand: body.testCommand ? String(body.testCommand) : undefined,
          maxAutoFixAttempts:
            typeof body.maxAutoFixAttempts === 'number'
              ? body.maxAutoFixAttempts
              : undefined
        });

        sendJson(res, 201, {
          ok: true,
          data: snapshot
        });
        return;
      }

      if (method === 'POST' && path === '/evolution/auto-improve') {
        const body = asRecord(await parseBody(req));
        const orchestrator = AutoImprovementOrchestrator.fromEvolutionService(options.service, {
          autoApprove: typeof body.autoApprove === 'boolean' ? body.autoApprove : undefined,
          autoApproveBy: body.autoApproveBy ? String(body.autoApproveBy) : undefined,
          autoApproveNote: body.autoApproveNote ? String(body.autoApproveNote) : undefined,
          triggerStatuses: asTriggerStatuses(body.triggerStatuses),
          baseBranch: body.baseBranch ? String(body.baseBranch) : undefined,
          testCommand: body.testCommand ? String(body.testCommand) : undefined,
          maxAutoFixAttempts:
            typeof body.maxAutoFixAttempts === 'number' ? body.maxAutoFixAttempts : undefined
        });

        const result = await orchestrator.handleOutcome({
          workflowId: String(body.workflowId ?? 'default-workflow'),
          status: asStatus(body.status),
          failures: asFailureList(body.failures),
          sourceRunPath: body.sourceRunPath ? String(body.sourceRunPath) : undefined,
          notes: body.notes ? String(body.notes) : undefined,
          title: body.title ? String(body.title) : undefined,
          requestedBy: body.requestedBy ? String(body.requestedBy) : undefined
        });

        sendJson(res, 200, {
          ok: true,
          data: result
        });
        return;
      }

      const detailMatch = path.match(/^\/evolution\/jobs\/([^/]+)$/);
      if (method === 'GET' && detailMatch) {
        const snapshot = await options.service.getSnapshot(detailMatch[1]!);
        sendJson(res, 200, {
          ok: true,
          data: snapshot
        });
        return;
      }

      const retryMatch = path.match(/^\/evolution\/jobs\/([^/]+)\/retry$/);
      if (method === 'POST' && retryMatch) {
        const snapshot = await options.service.retryJob(retryMatch[1]!);
        sendJson(res, 200, {
          ok: true,
          data: snapshot
        });
        return;
      }

      const approveMatch = path.match(/^\/evolution\/jobs\/([^/]+)\/approve$/);
      if (method === 'POST' && approveMatch) {
        const body = asRecord(await parseBody(req));
        const snapshot = await options.service.approveJob(approveMatch[1]!, {
          confirmedBy: String(body.confirmedBy ?? 'operator'),
          note: body.note ? String(body.note) : undefined
        });
        sendJson(res, 200, {
          ok: true,
          data: snapshot
        });
        return;
      }

      const rejectMatch = path.match(/^\/evolution\/jobs\/([^/]+)\/reject$/);
      if (method === 'POST' && rejectMatch) {
        const body = asRecord(await parseBody(req));
        const snapshot = await options.service.rejectJob(rejectMatch[1]!, {
          rejectedBy: String(body.rejectedBy ?? 'operator'),
          reason: body.reason ? String(body.reason) : undefined
        });
        sendJson(res, 200, {
          ok: true,
          data: snapshot
        });
        return;
      }

      const eventsMatch = path.match(/^\/evolution\/jobs\/([^/]+)\/events$/);
      if (method === 'GET' && eventsMatch) {
        const snapshot = await options.service.getSnapshot(eventsMatch[1]!);
        sendJson(res, 200, {
          ok: true,
          data: snapshot.events
        });
        return;
      }

      const streamMatch = path.match(/^\/evolution\/jobs\/([^/]+)\/stream$/);
      if (method === 'GET' && streamMatch) {
        const jobId = streamMatch[1]!;
        res.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-cache, no-transform',
          connection: 'keep-alive'
        });

        const sendSnapshot = async () => {
          const snapshot = await options.service.getSnapshot(jobId);
          res.write(`event: snapshot\n`);
          res.write(`data: ${JSON.stringify(snapshot)}\n\n`);
        };

        await sendSnapshot();
        const unsubscribe = options.service.onProgress(jobId, (snapshot) => {
          res.write(`event: snapshot\n`);
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

      if (method === 'GET' && (path === '/evolution/ui' || path === '/evolution/ui/')) {
        const indexPath = resolve(uiDir, 'index.html');
        const content = await readFile(indexPath, 'utf-8');
        res.writeHead(200, {
          'content-type': contentType(indexPath)
        });
        res.end(content);
        return;
      }

      if (method === 'GET' && path.startsWith('/evolution/ui/')) {
        const relative = path.slice('/evolution/ui/'.length);
        const filePath = resolve(uiDir, relative);
        const content = await readFile(filePath, 'utf-8');
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
      sendJson(res, 500, {
        ok: false,
        error: (error as Error).message
      });
    }
  });
}

export interface StartEvolutionServerOptions {
  host?: string;
  port?: number;
  repoRoot?: string;
  stateRoot?: string;
  uiDir?: string;
}

export function createEvolutionServiceFromEnv(repoRoot: string, stateRoot: string): EvolutionService {
  const rawAutoFixAttempts = process.env.EVOLUTION_MAX_AUTOFIX_ATTEMPTS
    ? Number(process.env.EVOLUTION_MAX_AUTOFIX_ATTEMPTS)
    : undefined;
  const rawTestTimeoutMs = process.env.EVOLUTION_TEST_TIMEOUT_MS
    ? Number(process.env.EVOLUTION_TEST_TIMEOUT_MS)
    : undefined;

  return new EvolutionService({
    repoRoot,
    stateRoot,
    baseBranch: process.env.EVOLUTION_BASE_BRANCH,
    defaultTestCommand: process.env.EVOLUTION_TEST_COMMAND,
    maxAutoFixAttempts: Number.isFinite(rawAutoFixAttempts ?? Number.NaN)
      ? rawAutoFixAttempts
      : undefined,
    testTimeoutMs: Number.isFinite(rawTestTimeoutMs ?? Number.NaN) ? rawTestTimeoutMs : undefined
  });
}

export function startEvolutionServer(options: StartEvolutionServerOptions = {}) {
  const sourceDir = dirname(fileURLToPath(import.meta.url));
  const runtimeRoot = resolve(sourceDir, '..', '..');
  const repoRoot = options.repoRoot ?? process.env.EVOLUTION_REPO_ROOT ?? resolve(runtimeRoot, '..');
  const stateRoot =
    options.stateRoot ??
    process.env.EVOLUTION_STATE_ROOT ??
    resolve(repoRoot, 'testing', 'evolution', 'state');
  const uiDir = options.uiDir ?? resolve(runtimeRoot, 'evolution-ui');

  const service = createEvolutionServiceFromEnv(repoRoot, stateRoot);
  const server = createEvolutionHttpServer({ service, uiDir });
  const host = options.host ?? process.env.EVOLUTION_SERVER_HOST ?? '127.0.0.1';
  const port =
    options.port ??
    (process.env.EVOLUTION_SERVER_PORT ? Number(process.env.EVOLUTION_SERVER_PORT) : 4777);

  server.listen(port, host, () => {
    // eslint-disable-next-line no-console
    console.log(`[evolution-server] listening on http://${host}:${port}`);
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
  startEvolutionServer();
}
