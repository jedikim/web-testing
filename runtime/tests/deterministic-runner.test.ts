import { describe, expect, it } from 'vitest';

import { executeWorkflow } from '../src/engine/deterministic-runner';
import type { AdapterExecutionResult, DeterministicAdapter } from '../src/engine/types';
import type { WorkflowDefinition, WorkflowNode } from '../src/workflow/types';

class FakeAdapter implements DeterministicAdapter {
  private readonly handlers: Record<string, (attempt: number) => AdapterExecutionResult>;

  constructor(handlers: Record<string, (attempt: number) => AdapterExecutionResult>) {
    this.handlers = handlers;
  }

  async execute(node: WorkflowNode, attempt: number): Promise<AdapterExecutionResult> {
    const handler = this.handlers[node.id];
    if (!handler) {
      return { ok: true };
    }
    return handler(attempt);
  }
}

describe('executeWorkflow', () => {
  it('passes deterministic scenario and retries recoverable failures', async () => {
    const workflow: WorkflowDefinition = {
      workflowId: 'scenario_v1',
      nodes: [
        { id: 'n1', type: 'NavigateNode', op: 'goto', next: 'n2' },
        { id: 'n2', type: 'ActionNode', op: 'click', next: 'n3' },
        { id: 'n3', type: 'VerifyNode', op: 'assert_results_exist' }
      ]
    };

    const adapter = new FakeAdapter({
      n2: (attempt) =>
        attempt === 1
          ? { ok: false, failureCode: 'ActionNotApplied', message: 'temporary miss' }
          : { ok: true }
    });

    const result = await executeWorkflow(workflow, { adapter, maxAttemptsPerNode: 3 });
    expect(result.status).toBe('pass');
    expect(result.failures).toHaveLength(0);
    expect(result.steps.map((s) => s.nodeId)).toEqual(['n1', 'n2', 'n3']);
    expect(result.steps.find((s) => s.nodeId === 'n2')?.attempts).toBe(2);
  });

  it('stops with blocked when handoff node is reached', async () => {
    const workflow: WorkflowDefinition = {
      workflowId: 'handoff_case',
      nodes: [{ id: 'n1', type: 'HandoffNode', op: 'human_approval' }]
    };

    const adapter = new FakeAdapter({});
    const result = await executeWorkflow(workflow, { adapter });

    expect(result.status).toBe('blocked');
    expect(result.failures[0]?.code).toBe('AuthBlocked');
  });

  it('fails when verify node keeps failing until attempts are exhausted', async () => {
    const workflow: WorkflowDefinition = {
      workflowId: 'verify_fail_case',
      nodes: [{ id: 'n1', type: 'VerifyNode', op: 'assert_done' }]
    };

    const adapter = new FakeAdapter({
      n1: () => ({
        ok: false,
        failureCode: 'ExpectationFailed',
        message: 'expected marker not found'
      })
    });

    const result = await executeWorkflow(workflow, { adapter, maxAttemptsPerNode: 2 });
    expect(result.status).toBe('fail');
    expect(result.failures[0]?.code).toBe('ExpectationFailed');
    expect(result.steps[0]?.attempts).toBe(2);
    expect(result.steps[0]?.success).toBe(false);
  });

  it('applies self-healing taxonomy classification and suggested action on failure', async () => {
    const workflow: WorkflowDefinition = {
      workflowId: 'healing_case',
      nodes: [{ id: 'n1', type: 'ActionNode', op: 'click_login' }]
    };

    const adapter = new FakeAdapter({
      n1: () => ({
        ok: false,
        failureCode: 'ActionNotApplied',
        message: 'Element is not visible and cannot be clicked'
      })
    });

    const result = await executeWorkflow(workflow, { adapter, maxAttemptsPerNode: 1 });
    expect(result.status).toBe('fail');
    expect(result.failures[0]?.code).toBe('HiddenElement');
    expect(result.failures[0]?.suggestedAction).toContain('menu');
  });

  it('supports branch + loop flow without llm', async () => {
    const workflow: WorkflowDefinition = {
      workflowId: 'branch_loop_case',
      nodes: [
        { id: 'n1', type: 'BranchNode', op: 'if_has_items', onTrue: 'n2', onFalse: 'n3' },
        { id: 'n2', type: 'LoopNode', op: 'collect', body: ['n4'], next: 'n5' },
        { id: 'n3', type: 'ActionNode', op: 'noop' },
        { id: 'n4', type: 'ActionNode', op: 'click_more' },
        { id: 'n5', type: 'VerifyNode', op: 'assert_collected' }
      ]
    };

    const adapter = new FakeAdapter({});
    const result = await executeWorkflow(workflow, {
      adapter,
      branchDecisions: { n1: true },
      loopIterations: { n2: 2 }
    });

    expect(result.status).toBe('pass');
    expect(result.steps.map((s) => s.nodeId)).toEqual(['n1', 'n2', 'n4', 'n4', 'n5']);
  });
});
