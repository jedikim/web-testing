import type { FailureCode } from '../types';
import type { WorkflowNode } from '../workflow/types';

export interface AdapterExecutionResult {
  ok: boolean;
  failureCode?: FailureCode;
  message?: string;
  data?: unknown;
}

export interface DeterministicAdapter {
  execute(node: WorkflowNode, attempt: number): Promise<AdapterExecutionResult>;
}

export interface ExecutionStep {
  nodeId: string;
  nodeType: WorkflowNode['type'];
  op: string;
  attempts: number;
  success: boolean;
}
