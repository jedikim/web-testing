import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import { loadProviderMatrixEnv } from '../src/config/provider-matrix-env';
import { createHttpProviderExecutors } from '../src/testing/provider-http-executor';
import { runProviderModelMatrix } from '../src/testing/provider-model-matrix';

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf-8')) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function respondJson(res: ServerResponse, payload: unknown): void {
  res.statusCode = 200;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(payload));
}

describe('provider matrix e2e (mock server)', () => {
  let server: ReturnType<typeof createServer> | undefined;

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server!.close((error) => (error ? reject(error) : resolve()));
      });
      server = undefined;
    }
  });

  it('runs gemini/openai + rfdetr multi-model matrix over http', async () => {
    const calls: string[] = [];
    server = createServer(async (req, res) => {
      const url = req.url ?? '';
      calls.push(url);
      await readJson(req);

      if (url.includes('/openai/chat/completions')) {
        respondJson(res, { choices: [{ message: { content: 'ok' } }] });
        return;
      }
      if (url.includes('/gemini/models/') && url.includes(':generateContent')) {
        respondJson(res, { candidates: [{ content: { parts: [{ text: 'ok' }] } }] });
        return;
      }
      if (url.includes('/rfdetr/detect')) {
        respondJson(res, { detections: [] });
        return;
      }

      res.statusCode = 404;
      res.end('not found');
    });

    await new Promise<void>((resolve, reject) => {
      server!.listen(0, '127.0.0.1', (error?: Error) => (error ? reject(error) : resolve()));
    });

    const address = server.address() as AddressInfo;
    const root = `http://${address.address}:${address.port}`;
    const matrixEnv = loadProviderMatrixEnv({
      LLM_VENDOR_ORDER: 'gemini,openai',
      GEMINI_API_KEY: 'gm-key',
      GEMINI_BASE_URL: `${root}/gemini`,
      GEMINI_MODELS: 'gemini-3.1-pro-preview,gemini-3-flash-preview',
      OPENAI_API_KEY: 'oa-key',
      OPENAI_BASE_URL: `${root}/openai`,
      OPENAI_MODELS: 'gpt-5-codex,gpt-5-mini',
      RFDETR_ENABLED: '1',
      RFDETR_API_KEY: 'yo-key',
      RFDETR_BASE_URL: `${root}/rfdetr`,
      RFDETR_MODELS: 'rf-detr-medium'
    });

    const executors = createHttpProviderExecutors({
      llmPrompt: 'patch-only json',
      visionInput: 'runs/mock.png'
    });

    const report = await runProviderModelMatrix({
      llmTargets: matrixEnv.llmTargets,
      visionTargets: matrixEnv.visionTargets,
      executeLlm: executors.executeLlm,
      executeVision: executors.executeVision
    });

    expect(report.summary.total).toBe(5);
    expect(report.summary.passed).toBe(5);
    expect(report.summary.failed).toBe(0);
    expect(calls.filter((url) => url.includes('/openai/chat/completions')).length).toBe(2);
    expect(calls.filter((url) => url.includes(':generateContent')).length).toBe(2);
    expect(calls.filter((url) => url.includes('/rfdetr/detect')).length).toBe(1);
  });
});
