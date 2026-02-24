import type {
  BranchNode,
  LoopNode,
  WorkflowDefinition,
  WorkflowValidationError,
  WorkflowValidationResult
} from './types';

function hasNodeReferences(node: { next?: string }): string[] {
  const refs: string[] = [];
  if (node.next) {
    refs.push(node.next);
  }
  return refs;
}

export function validateWorkflow(workflow: WorkflowDefinition): WorkflowValidationResult {
  const errors: WorkflowValidationError[] = [];

  if (!workflow.workflowId?.trim()) {
    errors.push({
      code: 'MISSING_WORKFLOW_ID',
      message: 'workflowId is required'
    });
  }

  if (!workflow.nodes || workflow.nodes.length === 0) {
    errors.push({
      code: 'EMPTY_NODES',
      message: 'nodes must contain at least one node'
    });
    return { valid: false, errors };
  }

  const nodeIds = new Set<string>();

  for (const node of workflow.nodes) {
    if (nodeIds.has(node.id)) {
      errors.push({
        code: 'DUPLICATE_NODE_ID',
        message: `duplicate node id: ${node.id}`,
        nodeId: node.id
      });
      continue;
    }
    nodeIds.add(node.id);
  }

  for (const node of workflow.nodes) {
    const refs = hasNodeReferences(node);

    if (node.type === 'BranchNode') {
      const branch = node as BranchNode;
      if (branch.onTrue) refs.push(branch.onTrue);
      if (branch.onFalse) refs.push(branch.onFalse);
    }

    if (node.type === 'LoopNode') {
      const loop = node as LoopNode;
      if (loop.body) refs.push(...loop.body);
    }

    for (const ref of refs) {
      if (!nodeIds.has(ref)) {
        errors.push({
          code: 'UNKNOWN_NODE_REFERENCE',
          message: `node ${node.id} references unknown node ${ref}`,
          nodeId: node.id,
          reference: ref
        });
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}
