import type { RunStatus } from '../types';

export interface RunMetricInput {
  durationMs: number;
  llmCalls: number;
  costUsd: number;
  status: RunStatus;
}

export interface MetricsSummary {
  totalRuns: number;
  avgLatencyMs: number;
  totalCostUsd: number;
  failureRate: number;
  llmCallsPerRun: number;
}

export class MetricsDashboard {
  private readonly records: RunMetricInput[] = [];

  recordRun(input: RunMetricInput): void {
    this.records.push(input);
  }

  summary(): MetricsSummary {
    if (this.records.length === 0) {
      return {
        totalRuns: 0,
        avgLatencyMs: 0,
        totalCostUsd: 0,
        failureRate: 0,
        llmCallsPerRun: 0
      };
    }

    const totalRuns = this.records.length;
    const totalLatency = this.records.reduce((acc, row) => acc + row.durationMs, 0);
    const totalCost = this.records.reduce((acc, row) => acc + row.costUsd, 0);
    const totalLlmCalls = this.records.reduce((acc, row) => acc + row.llmCalls, 0);
    const failureCount = this.records.filter((row) => row.status === 'fail').length;

    return {
      totalRuns,
      avgLatencyMs: totalLatency / totalRuns,
      totalCostUsd: totalCost,
      failureRate: failureCount / totalRuns,
      llmCallsPerRun: totalLlmCalls / totalRuns
    };
  }
}
