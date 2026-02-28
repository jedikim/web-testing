import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import type { V3OrchestratorService } from './v3-orchestrator-service';

interface JsonResponse {
  ok: boolean;
  data?: unknown;
  error?: string;
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
  }
  if (chunks.length === 0) {
    return {};
  }
  const raw = Buffer.concat(chunks).toString('utf-8').trim();
  if (!raw) {
    return {};
  }
  return JSON.parse(raw) as unknown;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

export interface V3OrchestratorHttpServerOptions {
  service: V3OrchestratorService;
}

export function createV3OrchestratorHttpServer(options: V3OrchestratorHttpServerOptions) {
  return createServer(async (req, res) => {
    try {
      const method = req.method ?? 'GET';
      const url = new URL(req.url ?? '/', 'http://localhost');
      const path = url.pathname;

      if (method === 'GET' && path === '/v3/health') {
        sendJson(res, 200, {
          ok: true,
          data: {
            status: 'up',
            mode: 'v3_orchestrator'
          }
        });
        return;
      }

      if (method === 'POST' && path === '/v3/run') {
        const body = asRecord(await parseBody(req));
        const result = await options.service.runTask({
          task: String(body.task ?? ''),
          targetUrl: body.targetUrl ? String(body.targetUrl) : undefined,
          browserMode: body.browserMode === 'headful' ? 'headful' : 'headless'
        });
        sendJson(res, 200, {
          ok: true,
          data: result
        });
        return;
      }

      sendJson(res, 404, {
        ok: false,
        error: `route not found: ${method} ${path}`
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      sendJson(res, 400, {
        ok: false,
        error: message
      });
    }
  });
}
