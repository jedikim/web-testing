import { describe, expect, it } from 'vitest';

import { validateWorkflow } from '../src/workflow/validate-workflow';
import type { WorkflowDefinition } from '../src/workflow/types';

const validWorkflow: WorkflowDefinition = {
  workflowId: 'shopping_search_v01',
  nodes: [
    { id: 'n1', type: 'NavigateNode', op: 'goto', next: 'n2' },
    { id: 'n2', type: 'ActionNode', op: 'type', next: 'n3' },
    { id: 'n3', type: 'VerifyNode', op: 'assert_results_exist' }
  ]
};

describe('validateWorkflow', () => {
  it('accepts a valid workflow', () => {
    const result = validateWorkflow(validWorkflow);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects duplicated node ids', () => {
    const duplicated: WorkflowDefinition = {
      workflowId: 'dup_case',
      nodes: [
        { id: 'n1', type: 'NavigateNode', op: 'goto' },
        { id: 'n1', type: 'ActionNode', op: 'click' }
      ]
    };

    const result = validateWorkflow(duplicated);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === 'DUPLICATE_NODE_ID')).toBe(true);
  });

  it('rejects missing references in next branch', () => {
    const invalidRef: WorkflowDefinition = {
      workflowId: 'bad_ref',
      nodes: [{ id: 'n1', type: 'NavigateNode', op: 'goto', next: 'missing' }]
    };

    const result = validateWorkflow(invalidRef);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === 'UNKNOWN_NODE_REFERENCE')).toBe(true);
  });

  it('rejects missing references in branch edges', () => {
    const invalidBranch: WorkflowDefinition = {
      workflowId: 'branch_ref',
      nodes: [
        {
          id: 'n1',
          type: 'BranchNode',
          op: 'if_state',
          onTrue: 'n2',
          onFalse: 'missing'
        },
        { id: 'n2', type: 'ActionNode', op: 'click' }
      ]
    };

    const result = validateWorkflow(invalidBranch);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === 'UNKNOWN_NODE_REFERENCE')).toBe(true);
  });
});
