import { describe, expect, it } from 'vitest';

import {
  AutoImprovementOrchestrator,
  type EvolutionController
} from '../src/evolution/auto-improvement-orchestrator';
import type { JobProgressSnapshot } from '../src/evolution/types';

function makeSnapshot(
  status: JobProgressSnapshot['job']['status']
): JobProgressSnapshot {
  return {
    job: {
      id: 'job-1',
      title: 'auto-improvement bug for wf-1',
      trigger: 'bug',
      workflowId: 'wf-1',
      status,
      requestedBy: 'tester',
      createdAt: '2026-02-24T00:00:00.000Z',
      updatedAt: '2026-02-24T00:00:00.000Z',
      modelPolicy: {
        codingModel: 'gemini-3.1-pro-preview',
        automationModel: 'gemini-3.0-flash'
      },
      baseBranch: 'main',
      testCommand: 'npm test',
      maxAutoFixAttempts: 1,
      currentVersion: 1,
      changelog: []
    },
    events: []
  };
}

describe('AutoImprovementOrchestrator', () => {
  it('does not trigger when status is outside trigger statuses', async () => {
    const controller: EvolutionController = {
      createJob: async () => makeSnapshot('draft'),
      waitForCompletion: async () => makeSnapshot('failed'),
      approveJob: async () => makeSnapshot('promoted')
    };

    const orchestrator = new AutoImprovementOrchestrator(controller, {
      triggerStatuses: ['fail']
    });

    const result = await orchestrator.handleOutcome({
      workflowId: 'wf-1',
      status: 'pass',
      failures: []
    });

    expect(result.triggered).toBe(false);
    expect(result.reason).toMatch(/outside trigger statuses/);
  });

  it('creates exception job when selector/visual/auth failures exist', async () => {
    let capturedTrigger: string | undefined;
    const controller: EvolutionController = {
      createJob: async (input) => {
        capturedTrigger = input.trigger;
        return makeSnapshot('draft');
      },
      waitForCompletion: async () => makeSnapshot('awaiting_approval'),
      approveJob: async () => makeSnapshot('promoted')
    };

    const orchestrator = new AutoImprovementOrchestrator(controller);

    const result = await orchestrator.handleOutcome({
      workflowId: 'wf-1',
      status: 'fail',
      failures: [
        {
          code: 'SelectorNotFound',
          message: 'button selector drift'
        }
      ]
    });

    expect(result.triggered).toBe(true);
    expect(capturedTrigger).toBe('exception');
    expect(result.completed?.job.status).toBe('awaiting_approval');
    expect(result.approved).toBeUndefined();
  });

  it('auto-approves when policy returns true', async () => {
    let approveCalled = false;
    const controller: EvolutionController = {
      createJob: async () => makeSnapshot('draft'),
      waitForCompletion: async () => makeSnapshot('awaiting_approval'),
      approveJob: async () => {
        approveCalled = true;
        return makeSnapshot('promoted');
      }
    };

    const orchestrator = new AutoImprovementOrchestrator(controller, {
      autoApprove: true,
      autoApproveBy: 'policy-bot'
    });

    const result = await orchestrator.handleOutcome({
      workflowId: 'wf-1',
      status: 'fail',
      failures: [
        {
          code: 'Unknown',
          message: 'unknown failure'
        }
      ]
    });

    expect(result.triggered).toBe(true);
    expect(approveCalled).toBe(true);
    expect(result.approved?.job.status).toBe('promoted');
  });
});
