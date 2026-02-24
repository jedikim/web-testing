import { describe, expect, it } from 'vitest';

import { MetricsDashboard } from '../src/ops/metrics-dashboard';

describe('MetricsDashboard', () => {
  it('aggregates latency/cost/failure metrics', () => {
    const dashboard = new MetricsDashboard();
    dashboard.recordRun({ durationMs: 1000, llmCalls: 1, costUsd: 0.02, status: 'pass' });
    dashboard.recordRun({ durationMs: 3000, llmCalls: 0, costUsd: 0.0, status: 'fail' });

    const summary = dashboard.summary();
    expect(summary.totalRuns).toBe(2);
    expect(summary.avgLatencyMs).toBe(2000);
    expect(summary.totalCostUsd).toBe(0.02);
    expect(summary.failureRate).toBe(0.5);
  });
});
