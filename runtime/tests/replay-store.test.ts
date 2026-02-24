import { describe, expect, it } from 'vitest';

import { ReplayStore } from '../src/learning/replay-store';
import type { RunArtifact } from '../src/types';

function sampleRun(id: string, status: RunArtifact['status']): RunArtifact {
  return {
    runId: id,
    workflowId: 'shopping_search_v01',
    status,
    startedAt: '2026-02-24T10:00:00Z',
    endedAt: '2026-02-24T10:00:10Z',
    durationMs: 10000,
    context: { mode: 'screenshot', browser: 'chromium', targetUrl: 'https://example.com' },
    steps: [],
    failures: [],
    review: { decision: 'approve', blockerMajorCount: 0, unresolvedMinorNit: 0 },
    evidence: []
  };
}

describe('ReplayStore', () => {
  it('stores and returns runs by workflow id', () => {
    const store = new ReplayStore();
    store.add(sampleRun('r1', 'pass'));
    store.add(sampleRun('r2', 'fail'));

    const rows = store.getByWorkflow('shopping_search_v01');
    expect(rows).toHaveLength(2);
    expect(rows.map((x) => x.runId)).toEqual(['r1', 'r2']);
  });

  it('filters failed runs for replay queue', () => {
    const store = new ReplayStore();
    store.add(sampleRun('r1', 'pass'));
    store.add(sampleRun('r2', 'fail'));
    store.add(sampleRun('r3', 'blocked'));

    const failed = store.getFailedRuns('shopping_search_v01');
    expect(failed.map((x) => x.runId)).toEqual(['r2']);
  });
});
