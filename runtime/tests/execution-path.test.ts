import { describe, expect, it } from 'vitest';

import { buildExecutionPath } from '../src/workflow/build-execution-path';
import type { WorkflowDefinition } from '../src/workflow/types';

describe('buildExecutionPath', () => {
  it('builds path for linear nodes', () => {
    const workflow: WorkflowDefinition = {
      workflowId: 'linear',
      nodes: [
        { id: 'n1', type: 'NavigateNode', op: 'goto', next: 'n2' },
        { id: 'n2', type: 'ActionNode', op: 'click', next: 'n3' },
        { id: 'n3', type: 'VerifyNode', op: 'assert' }
      ]
    };

    const result = buildExecutionPath(workflow);
    expect(result.path).toEqual(['n1', 'n2', 'n3']);
    expect(result.errors).toHaveLength(0);
  });

  it('selects branch targets by decision map', () => {
    const workflow: WorkflowDefinition = {
      workflowId: 'branch',
      nodes: [
        {
          id: 'n1',
          type: 'BranchNode',
          op: 'if_state',
          onTrue: 'n2',
          onFalse: 'n3'
        },
        { id: 'n2', type: 'ActionNode', op: 'click' },
        { id: 'n3', type: 'ActionNode', op: 'scroll' }
      ]
    };

    const onTrue = buildExecutionPath(workflow, { branchDecisions: { n1: true } });
    const onFalse = buildExecutionPath(workflow, { branchDecisions: { n1: false } });

    expect(onTrue.path).toEqual(['n1', 'n2']);
    expect(onFalse.path).toEqual(['n1', 'n3']);
  });

  it('expands loop body once before next', () => {
    const workflow: WorkflowDefinition = {
      workflowId: 'loop',
      nodes: [
        {
          id: 'n1',
          type: 'LoopNode',
          op: 'until_done',
          body: ['n2', 'n3'],
          next: 'n4'
        },
        { id: 'n2', type: 'DiscoverNode', op: 'extract' },
        { id: 'n3', type: 'ActionNode', op: 'click' },
        { id: 'n4', type: 'VerifyNode', op: 'assert' }
      ]
    };

    const result = buildExecutionPath(workflow);
    expect(result.path).toEqual(['n1', 'n2', 'n3', 'n4']);
  });

  it('returns error when branch target is unresolved at runtime', () => {
    const workflow: WorkflowDefinition = {
      workflowId: 'bad_branch',
      nodes: [
        { id: 'n1', type: 'BranchNode', op: 'if_state', onTrue: 'missing' },
        { id: 'n2', type: 'ActionNode', op: 'click' }
      ]
    };

    const result = buildExecutionPath(workflow, { branchDecisions: { n1: true } });
    expect(result.errors.some((e) => e.code === 'UNKNOWN_NODE_REFERENCE')).toBe(true);
  });
});
