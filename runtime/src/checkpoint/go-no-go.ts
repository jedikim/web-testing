export type CheckpointDecision = 'go' | 'not_go' | 'ask_user';

export interface CheckpointInput {
  confidence: number;
  threshold: number;
  sensitiveAction: boolean;
  userApproval?: boolean;
}

export interface CheckpointResult {
  decision: CheckpointDecision;
  reason: string;
}

export function evaluateCheckpoint(input: CheckpointInput): CheckpointResult {
  if (input.userApproval === false) {
    return { decision: 'not_go', reason: 'user rejected checkpoint' };
  }

  if (input.sensitiveAction && input.userApproval !== true) {
    return { decision: 'not_go', reason: 'sensitive action requires explicit approval' };
  }

  if (input.confidence < input.threshold) {
    return { decision: 'ask_user', reason: 'confidence below threshold' };
  }

  return { decision: 'go', reason: 'confidence and policy satisfied' };
}
