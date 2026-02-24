export type WorkflowNodeType =
  | 'NavigateNode'
  | 'DiscoverNode'
  | 'DecideNode'
  | 'ActionNode'
  | 'VerifyNode'
  | 'LoopNode'
  | 'BranchNode'
  | 'CheckpointNode'
  | 'HandoffNode';

export interface WorkflowNodeBase {
  id: string;
  type: WorkflowNodeType;
  op: string;
  next?: string;
}

export interface BranchNode extends WorkflowNodeBase {
  type: 'BranchNode';
  onTrue?: string;
  onFalse?: string;
}

export interface LoopNode extends WorkflowNodeBase {
  type: 'LoopNode';
  body?: string[];
}

export type WorkflowNode = WorkflowNodeBase | BranchNode | LoopNode;

export interface WorkflowDefinition {
  workflowId: string;
  nodes: WorkflowNode[];
}

export type WorkflowValidationErrorCode =
  | 'MISSING_WORKFLOW_ID'
  | 'EMPTY_NODES'
  | 'DUPLICATE_NODE_ID'
  | 'UNKNOWN_NODE_REFERENCE';

export interface WorkflowValidationError {
  code: WorkflowValidationErrorCode;
  message: string;
  nodeId?: string;
  reference?: string;
}

export interface WorkflowValidationResult {
  valid: boolean;
  errors: WorkflowValidationError[];
}
