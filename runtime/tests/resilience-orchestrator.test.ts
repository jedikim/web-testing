import { describe, expect, it } from 'vitest';

import { ResilienceOrchestrator } from '../src/ops/resilience-orchestrator';

describe('ResilienceOrchestrator', () => {
  it('runs multiple scenarios under session limits', async () => {
    const orchestrator = new ResilienceOrchestrator({ maxConcurrentSessions: 2 });
    let active = 0;
    let maxSeen = 0;

    const result = await orchestrator.runAll(
      [
        { scenarioId: 's1', workflowId: 'w1' },
        { scenarioId: 's2', workflowId: 'w2' },
        { scenarioId: 's3', workflowId: 'w3' }
      ],
      {
        run: async () => {
          active += 1;
          maxSeen = Math.max(maxSeen, active);
          await new Promise((resolve) => setTimeout(resolve, 10));
          active -= 1;
          return { status: 'pass' };
        }
      }
    );

    expect(result.results).toHaveLength(3);
    expect(result.failedCount).toBe(0);
    expect(maxSeen).toBeLessThanOrEqual(2);
  });

  it('records rollback and recovers from failure', async () => {
    const orchestrator = new ResilienceOrchestrator({ maxConcurrentSessions: 1 });
    let failedOnce = false;

    const result = await orchestrator.runAll(
      [{ scenarioId: 's1', workflowId: 'w1' }],
      {
        run: async () => {
          if (!failedOnce) {
            failedOnce = true;
            return { status: 'fail', reason: 'selector regression' };
          }
          return { status: 'pass' };
        },
        recover: async () => ({ status: 'pass' })
      }
    );

    expect(result.recoveredCount).toBe(1);
    expect(result.failedCount).toBe(0);
    expect(result.rollbackEntries[0]?.changeId).toBe('s1');
  });
});
