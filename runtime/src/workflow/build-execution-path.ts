import type { BranchNode, LoopNode, WorkflowDefinition, WorkflowNode } from './types';

export interface BuildExecutionPathOptions {
  branchDecisions?: Record<string, boolean>;
  maxSteps?: number;
}

export interface ExecutionPathError {
  code: 'UNKNOWN_NODE_REFERENCE' | 'CYCLE_DETECTED';
  message: string;
  nodeId?: string;
  reference?: string;
}

export interface ExecutionPathResult {
  path: string[];
  errors: ExecutionPathError[];
}

function getBranchTarget(node: BranchNode, branchDecisions?: Record<string, boolean>): string | undefined {
  const decision = branchDecisions?.[node.id];
  if (decision === true) {
    return node.onTrue;
  }
  return node.onFalse;
}

function resolveNode(
  nodeById: Map<string, WorkflowNode>,
  id: string,
  errors: ExecutionPathError[],
  fromNodeId: string
): WorkflowNode | undefined {
  const node = nodeById.get(id);
  if (!node) {
    errors.push({
      code: 'UNKNOWN_NODE_REFERENCE',
      message: `node ${fromNodeId} references unknown node ${id}`,
      nodeId: fromNodeId,
      reference: id
    });
  }
  return node;
}

export function buildExecutionPath(
  workflow: WorkflowDefinition,
  options: BuildExecutionPathOptions = {}
): ExecutionPathResult {
  const path: string[] = [];
  const errors: ExecutionPathError[] = [];

  if (!workflow.nodes.length) {
    return { path, errors };
  }

  const nodeById = new Map(workflow.nodes.map((n) => [n.id, n]));
  const maxSteps = options.maxSteps ?? workflow.nodes.length * 3;

  let current: WorkflowNode | undefined = workflow.nodes[0];
  let stepCount = 0;

  while (current && stepCount < maxSteps) {
    stepCount += 1;
    path.push(current.id);

    if (current.type === 'LoopNode') {
      const loop = current as LoopNode;
      for (const ref of loop.body ?? []) {
        const loopNode = resolveNode(nodeById, ref, errors, loop.id);
        if (loopNode) {
          path.push(loopNode.id);
        }
      }
    }

    let nextId: string | undefined;
    if (current.type === 'BranchNode') {
      nextId = getBranchTarget(current as BranchNode, options.branchDecisions);
    } else {
      nextId = current.next;
    }

    if (!nextId) {
      break;
    }

    current = resolveNode(nodeById, nextId, errors, current.id);
    if (!current) {
      break;
    }
  }

  if (stepCount >= maxSteps) {
    errors.push({
      code: 'CYCLE_DETECTED',
      message: 'execution path exceeded maxSteps'
    });
  }

  return { path, errors };
}
