import type { RunFailure, RunStatus } from '../types';
import { shouldRetry } from '../policies/retry-policy';
import { classifyFailureCode, suggestedHealingAction } from '../policies/self-healing-taxonomy';
import { validateWorkflow } from '../workflow/validate-workflow';
import type { BranchNode, LoopNode, WorkflowDefinition, WorkflowNode } from '../workflow/types';
import type { DeterministicAdapter, ExecutionStep } from './types';

export interface ExecuteWorkflowInput {
  adapter: DeterministicAdapter;
  maxAttemptsPerNode?: number;
  maxTotalSteps?: number;
  branchDecisions?: Record<string, boolean>;
  loopIterations?: Record<string, number>;
}

export interface ExecuteWorkflowResult {
  status: RunStatus;
  steps: ExecutionStep[];
  failures: RunFailure[];
}

function asFailure(
  code: RunFailure['code'],
  message: string,
  stepId?: string,
  suggestedAction?: string
): RunFailure {
  return { code, message, stepId, suggestedAction };
}

function resolveNode(nodeById: Map<string, WorkflowNode>, id?: string): WorkflowNode | undefined {
  if (!id) {
    return undefined;
  }
  return nodeById.get(id);
}

function getBranchTarget(node: BranchNode, branchDecisions?: Record<string, boolean>): string | undefined {
  if (branchDecisions?.[node.id] === true) {
    return node.onTrue;
  }
  return node.onFalse;
}

export async function executeWorkflow(
  workflow: WorkflowDefinition,
  input: ExecuteWorkflowInput
): Promise<ExecuteWorkflowResult> {
  const steps: ExecutionStep[] = [];
  const failures: RunFailure[] = [];

  const validation = validateWorkflow(workflow);
  if (!validation.valid) {
    return {
      status: 'fail',
      steps,
      failures: validation.errors.map((error) =>
        asFailure('Unknown', error.message, error.nodeId)
      )
    };
  }

  const nodeById = new Map(workflow.nodes.map((node) => [node.id, node]));
  const maxAttemptsPerNode = input.maxAttemptsPerNode ?? 2;
  const maxTotalSteps = input.maxTotalSteps ?? workflow.nodes.length * 10;
  let consumedSteps = 0;

  const runOperationalNode = async (
    node: WorkflowNode
  ): Promise<{ ok: true } | { ok: false; status: RunStatus }> => {
    if (node.type === 'HandoffNode') {
      steps.push({
        nodeId: node.id,
        nodeType: node.type,
        op: node.op,
        attempts: 1,
        success: false
      });
      failures.push(asFailure('AuthBlocked', 'handoff node requires human action', node.id));
      return { ok: false, status: 'blocked' };
    }

    let attempt = 1;
    while (attempt <= maxAttemptsPerNode) {
      const result = await input.adapter.execute(node, attempt);
      if (result.ok) {
        steps.push({
          nodeId: node.id,
          nodeType: node.type,
          op: node.op,
          attempts: attempt,
          success: true
        });
        return { ok: true };
      }

      const code = classifyFailureCode({
        failureCode: result.failureCode ?? 'Unknown',
        message: result.message
      });
      const message = result.message ?? `${node.id} failed`;
      if (!shouldRetry({ attempt, maxAttempts: maxAttemptsPerNode, failureCode: code })) {
        steps.push({
          nodeId: node.id,
          nodeType: node.type,
          op: node.op,
          attempts: attempt,
          success: false
        });
        failures.push(asFailure(code, message, node.id, suggestedHealingAction(code)));
        return { ok: false, status: code === 'AuthBlocked' ? 'blocked' : 'fail' };
      }
      attempt += 1;
    }

    steps.push({
      nodeId: node.id,
      nodeType: node.type,
      op: node.op,
      attempts: maxAttemptsPerNode,
      success: false
    });
    failures.push(asFailure('Unknown', `${node.id} failed without retry exit`, node.id));
    return { ok: false, status: 'fail' };
  };

  const executeReferencedNode = async (
    nodeId: string
  ): Promise<{ ok: true } | { ok: false; status: RunStatus }> => {
    const refNode = resolveNode(nodeById, nodeId);
    if (!refNode) {
      failures.push(asFailure('Unknown', `unknown node reference: ${nodeId}`));
      return { ok: false, status: 'fail' };
    }
    consumedSteps += 1;
    if (consumedSteps > maxTotalSteps) {
      failures.push(asFailure('Unknown', 'maxTotalSteps exceeded'));
      return { ok: false, status: 'fail' };
    }
    return runOperationalNode(refNode);
  };

  let current: WorkflowNode | undefined = workflow.nodes[0];
  while (current) {
    consumedSteps += 1;
    if (consumedSteps > maxTotalSteps) {
      failures.push(asFailure('Unknown', 'maxTotalSteps exceeded'));
      return { status: 'fail', steps, failures };
    }

    if (current.type === 'BranchNode') {
      steps.push({
        nodeId: current.id,
        nodeType: current.type,
        op: current.op,
        attempts: 1,
        success: true
      });
      const nextId = getBranchTarget(current as BranchNode, input.branchDecisions);
      if (!nextId) {
        break;
      }
      const nextNode = resolveNode(nodeById, nextId);
      if (!nextNode) {
        failures.push(asFailure('Unknown', `unknown node reference: ${nextId}`, current.id));
        return { status: 'fail', steps, failures };
      }
      current = nextNode;
      continue;
    }

    if (current.type === 'LoopNode') {
      steps.push({
        nodeId: current.id,
        nodeType: current.type,
        op: current.op,
        attempts: 1,
        success: true
      });

      const loopNode = current as LoopNode;
      const iterations = Math.max(1, input.loopIterations?.[loopNode.id] ?? 1);
      for (let i = 0; i < iterations; i += 1) {
        for (const ref of loopNode.body ?? []) {
          const result = await executeReferencedNode(ref);
          if (!result.ok) {
            return { status: result.status, steps, failures };
          }
        }
      }

      const nextNode = resolveNode(nodeById, loopNode.next);
      current = nextNode;
      continue;
    }

    const result = await runOperationalNode(current);
    if (!result.ok) {
      return { status: result.status, steps, failures };
    }

    current = resolveNode(nodeById, current.next);
  }

  return {
    status: 'pass',
    steps,
    failures
  };
}
