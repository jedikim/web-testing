import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import { afterEach, describe, expect, it } from 'vitest';

import { createEvolutionApiClient } from '../src/sdk/evolution-api-client';

const servers: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (servers.length > 0) {
    const close = servers.pop();
    if (close) {
      await close();
    }
  }
});

type TestHandler = (req: IncomingMessage, res: ServerResponse) => void;

async function startServer(handler: TestHandler): Promise<string> {
  const server = createServer(handler);
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('failed to open test server');
  }

  servers.push(
    () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      })
  );

  return `http://127.0.0.1:${address.port}`;
}

function json(data: unknown): string {
  return JSON.stringify(data);
}

describe('EvolutionApiClient', () => {
  it('calls list/create/get/approve endpoints', async () => {
    const baseUrl = await startServer((req, res) => {
      if (req.url === '/evolution/jobs' && req.method === 'GET') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          json({
            ok: true,
            data: [
              {
                id: 'job-1',
                status: 'awaiting_approval'
              }
            ]
          })
        );
        return;
      }

      if (req.url === '/evolution/jobs' && req.method === 'POST') {
        res.writeHead(201, { 'content-type': 'application/json' });
        res.end(
          json({
            ok: true,
            data: {
              job: {
                id: 'job-1',
                status: 'draft'
              },
              events: []
            }
          })
        );
        return;
      }

      if (req.url === '/evolution/jobs/job-1' && req.method === 'GET') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          json({
            ok: true,
            data: {
              schemaVersion: 'evolution.job.snapshot.v1',
              emittedAt: '2026-02-24T00:00:00.000Z',
              job: {
                id: 'job-1',
                status: 'awaiting_approval'
              },
              events: []
            }
          })
        );
        return;
      }

      if (req.url === '/evolution/jobs/job-1/diff' && req.method === 'GET') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          json({
            ok: true,
            data: {
              schemaVersion: 'evolution.job.diff.v1',
              emittedAt: '2026-02-24T00:00:00.000Z',
              jobId: 'job-1',
              workflowId: 'wf-1',
              status: 'awaiting_approval',
              attempts: []
            }
          })
        );
        return;
      }

      if (req.url === '/evolution/versions' && req.method === 'GET') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          json({
            ok: true,
            data: [
              {
                workflowId: 'wf-1',
                current: {
                  workflowId: 'wf-1',
                  jobId: 'job-1',
                  version: 1
                },
                history: []
              }
            ]
          })
        );
        return;
      }

      if (req.url === '/evolution/versions/wf-1' && req.method === 'GET') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          json({
            ok: true,
            data: {
              workflowId: 'wf-1',
              current: {
                workflowId: 'wf-1',
                jobId: 'job-1',
                version: 1
              },
              history: []
            }
          })
        );
        return;
      }

      if (req.url === '/evolution/versions/wf-1/current' && req.method === 'GET') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          json({
            ok: true,
            data: {
              workflowId: 'wf-1',
              jobId: 'job-1',
              version: 1
            }
          })
        );
        return;
      }

      if (req.url === '/evolution/versions/wf-1/history' && req.method === 'GET') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          json({
            ok: true,
            data: [
              {
                workflowId: 'wf-1',
                jobId: 'job-1',
                version: 1
              }
            ]
          })
        );
        return;
      }

      if (req.url === '/evolution/versions/wf-1/rollback' && req.method === 'POST') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          json({
            ok: true,
            data: {
              workflowId: 'wf-1',
              current: {
                workflowId: 'wf-1',
                jobId: 'job-1',
                version: 1,
                confirmedBy: 'rollback-user'
              },
              history: [
                {
                  workflowId: 'wf-1',
                  jobId: 'job-2',
                  version: 2
                },
                {
                  workflowId: 'wf-1',
                  jobId: 'job-1',
                  version: 1,
                  confirmedBy: 'rollback-user'
                }
              ]
            }
          })
        );
        return;
      }

      if (req.url === '/evolution/jobs/job-1/approve' && req.method === 'POST') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          json({
            ok: true,
            data: {
              schemaVersion: 'evolution.job.snapshot.v1',
              emittedAt: '2026-02-24T00:00:00.000Z',
              job: {
                id: 'job-1',
                status: 'promoted'
              },
              events: []
            }
          })
        );
        return;
      }

      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(json({ ok: false, error: 'not found' }));
    });

    const client = createEvolutionApiClient({ baseUrl });

    const jobs = await client.listJobs();
    expect(jobs[0]?.id).toBe('job-1');

    const created = await client.createJob({
      title: 'test',
      trigger: 'bug',
      workflowId: 'wf-1'
    });
    expect(created.job.id).toBe('job-1');

    const snapshot = await client.getSnapshot('job-1');
    expect(snapshot.job.status).toBe('awaiting_approval');
    expect(snapshot.schemaVersion).toBe('evolution.job.snapshot.v1');

    const diff = await client.getJobDiff('job-1');
    expect(diff.schemaVersion).toBe('evolution.job.diff.v1');
    expect(diff.jobId).toBe('job-1');

    const versionSummaries = await client.listVersionSummaries();
    expect(versionSummaries[0]?.workflowId).toBe('wf-1');

    const versionSummary = await client.getVersionSummary('wf-1');
    expect(versionSummary.workflowId).toBe('wf-1');

    const currentVersion = await client.getCurrentVersion('wf-1');
    expect(currentVersion?.jobId).toBe('job-1');

    const versionHistory = await client.getVersionHistory('wf-1');
    expect(versionHistory.length).toBe(1);

    const rollback = await client.rollbackVersion('wf-1', {
      targetVersion: 1,
      confirmedBy: 'rollback-user'
    });
    expect(rollback.current?.version).toBe(1);
    expect(rollback.current?.confirmedBy).toBe('rollback-user');

    const approved = await client.approveJob('job-1', {
      confirmedBy: 'tester'
    });
    expect(approved.job.status).toBe('promoted');
  });

  it('waits until terminal status', async () => {
    let calls = 0;

    const baseUrl = await startServer((req, res) => {
      if (req.url === '/evolution/jobs/job-2' && req.method === 'GET') {
        calls += 1;
        const status = calls < 3 ? 'testing' : 'failed';
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          json({
            ok: true,
            data: {
              schemaVersion: 'evolution.job.snapshot.v1',
              emittedAt: new Date().toISOString(),
              job: {
                id: 'job-2',
                status
              },
              events: []
            }
          })
        );
        return;
      }

      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(json({ ok: false, error: 'not found' }));
    });

    const client = createEvolutionApiClient({ baseUrl });
    const snapshot = await client.waitForTerminal('job-2', {
      timeoutMs: 10_000,
      intervalMs: 5
    });

    expect(snapshot.job.status).toBe('failed');
    expect(calls).toBeGreaterThanOrEqual(3);
  });
});
