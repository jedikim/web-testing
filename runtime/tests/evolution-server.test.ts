import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type {
  EvolutionSandbox,
  PrepareCandidateInput,
  RunTestsInput,
  RunTestsResult
} from '../src/evolution/git-sandbox';
import { EvolutionService } from '../src/evolution/service';
import { createEvolutionHttpServer } from '../src/evolution/server';

class StaticSandbox implements EvolutionSandbox {
  async prepareCandidate(input: PrepareCandidateInput) {
    const worktreePath = resolve(tmpdir(), `evolution-server-${input.jobId}-${input.version}`);
    await mkdir(worktreePath, { recursive: true });
    return {
      branchName: `evolution/${input.jobId}/v${String(input.version).padStart(3, '0')}`,
      worktreePath
    };
  }

  async runTests(input: RunTestsInput): Promise<RunTestsResult> {
    await mkdir(resolve(input.outputPath, '..'), { recursive: true });
    await writeFile(input.outputPath, 'pass', 'utf-8');
    const now = new Date().toISOString();
    return {
      ok: true,
      exitCode: 0,
      startedAt: now,
      endedAt: now,
      outputPath: input.outputPath
    };
  }

  async promoteCandidate() {
    return {
      ok: true,
      message: 'ok'
    };
  }
}

const serverRefs: Array<{ close: () => Promise<void> }> = [];

afterEach(async () => {
  while (serverRefs.length > 0) {
    const ref = serverRefs.pop();
    if (ref) {
      await ref.close();
    }
  }
});

async function startServer() {
  const stateRoot = await mkdtemp(resolve(tmpdir(), 'evo-server-state-'));
  const service = new EvolutionService({
    repoRoot: process.cwd(),
    stateRoot,
    sandbox: new StaticSandbox(),
    autoStart: true,
    maxAutoFixAttempts: 0,
    defaultTestCommand: 'echo test'
  });

  const uiDir = await mkdtemp(resolve(tmpdir(), 'evo-server-ui-'));
  await writeFile(resolve(uiDir, 'index.html'), '<!doctype html><title>ui</title>', 'utf-8');
  await writeFile(resolve(uiDir, 'app.js'), 'console.log("ok")', 'utf-8');

  const server = createEvolutionHttpServer({ service, uiDir });

  await new Promise<void>((resolvePromise) => {
    server.listen(0, '127.0.0.1', () => resolvePromise());
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('failed to resolve server address');
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

  return { baseUrl, service };
}

describe('evolution server', () => {
  it('creates and returns jobs through http API', async () => {
    const { baseUrl, service } = await startServer();

    const createResponse = await fetch(`${baseUrl}/evolution/jobs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: 'api test job',
        trigger: 'exception',
        workflowId: 'wf-api-1'
      })
    });

    expect(createResponse.status).toBe(201);
    const created = (await createResponse.json()) as {
      ok: boolean;
      data: { job: { id: string } };
    };

    expect(created.ok).toBe(true);
    await service.waitForCompletion(created.data.job.id);

    const jobsResponse = await fetch(`${baseUrl}/evolution/jobs`);
    const jobsPayload = (await jobsResponse.json()) as {
      ok: boolean;
      data: Array<{ id: string; status: string }>;
    };

    expect(jobsPayload.ok).toBe(true);
    expect(jobsPayload.data.length).toBeGreaterThan(0);
    expect(jobsPayload.data[0]?.status).toBe('awaiting_approval');
  });

  it('approves awaiting jobs and serves UI assets', async () => {
    const { baseUrl, service } = await startServer();

    const createResponse = await fetch(`${baseUrl}/evolution/jobs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: 'approve test job',
        trigger: 'bug',
        workflowId: 'wf-api-2'
      })
    });

    const created = (await createResponse.json()) as {
      data: { job: { id: string } };
    };

    await service.waitForCompletion(created.data.job.id);

    const approveResponse = await fetch(`${baseUrl}/evolution/jobs/${created.data.job.id}/approve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        confirmedBy: 'http-test'
      })
    });

    const approvePayload = (await approveResponse.json()) as {
      ok: boolean;
      data: { job: { status: string } };
    };

    expect(approvePayload.ok).toBe(true);
    expect(approvePayload.data.job.status).toBe('promoted');

    const uiResponse = await fetch(`${baseUrl}/evolution/ui`);
    const html = await uiResponse.text();
    expect(uiResponse.status).toBe(200);
    expect(html).toContain('<!doctype html>');
  });

  it('triggers auto-improvement endpoint and can auto-approve', async () => {
    const { baseUrl } = await startServer();

    const response = await fetch(`${baseUrl}/evolution/auto-improve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        workflowId: 'wf-auto-1',
        status: 'fail',
        failures: [
          {
            code: 'SelectorNotFound',
            message: 'selector drift'
          }
        ],
        autoApprove: true,
        requestedBy: 'http-auto-test'
      })
    });

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      ok: boolean;
      data: {
        triggered: boolean;
        completed?: { job: { status: string } };
        approved?: { job: { status: string } };
      };
    };

    expect(payload.ok).toBe(true);
    expect(payload.data.triggered).toBe(true);
    expect(payload.data.completed?.job.status).toBe('awaiting_approval');
    expect(payload.data.approved?.job.status).toBe('promoted');
  });
});
