import { describe, expect, it } from 'vitest';

import {
  createWebAutomationSdk,
  type AutoImprovementHandler
} from '../src/sdk/automation-sdk';
import type { AutomationFullFlowResult } from '../src/testing/automation-full-flow';
import type { WorkflowDefinition } from '../src/workflow/types';

const WORKFLOW: WorkflowDefinition = {
  workflowId: 'sdk-workflow',
  nodes: [
    {
      id: 'n1',
      type: 'NavigateNode',
      op: 'goto'
    }
  ]
};

function flowResult(finalStatus: AutomationFullFlowResult['finalStatus']): AutomationFullFlowResult {
  return {
    finalStatus,
    deterministic: {
      status: finalStatus,
      steps: [],
      failures: finalStatus === 'fail' ? [{ code: 'Unknown', message: 'failure' }] : []
    }
  };
}

describe('WebAutomationSdk', () => {
  it('returns flow only when improvement handler is absent', async () => {
    const sdk = createWebAutomationSdk({
      runner: async () => flowResult('pass')
    });

    const result = await sdk.runWithImprovement({
      workflow: WORKFLOW,
      adapter: {
        execute: async () => ({ ok: true })
      }
    });

    expect(result.flow.finalStatus).toBe('pass');
    expect(result.improvement).toBeUndefined();
  });

  it('triggers auto improvement when final status is fail', async () => {
    let called = 0;

    const handler: AutoImprovementHandler = {
      handleOutcome: async (outcome) => {
        called += 1;
        expect(outcome.workflowId).toBe('sdk-workflow');
        expect(outcome.status).toBe('fail');
        return {
          triggered: true,
          reason: 'triggered in test'
        };
      }
    };

    const sdk = createWebAutomationSdk({
      runner: async () => flowResult('fail'),
      autoImprovement: handler
    });

    const result = await sdk.runWithImprovement({
      workflow: WORKFLOW,
      adapter: {
        execute: async () => ({ ok: true })
      }
    });

    expect(called).toBe(1);
    expect(result.improvement?.triggered).toBe(true);
  });

  it('can treat blocked as improvement trigger by option', async () => {
    let called = 0;

    const handler: AutoImprovementHandler = {
      handleOutcome: async () => {
        called += 1;
        return {
          triggered: true
        };
      }
    };

    const sdk = createWebAutomationSdk({
      runner: async () => flowResult('blocked'),
      autoImprovement: handler,
      includeBlockedAsFailure: true
    });

    await sdk.runWithImprovement({
      workflow: WORKFLOW,
      adapter: {
        execute: async () => ({ ok: true })
      }
    });

    expect(called).toBe(1);
  });
});
