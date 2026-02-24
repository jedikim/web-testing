export type RunStatus = 'pass' | 'fail' | 'blocked';

export type ReviewDecision = 'approve' | 'rework' | 'not_run';

export type FailureCode =
  | 'SelectorNotFound'
  | 'ActionNotApplied'
  | 'ExpectationFailed'
  | 'VisualAmbiguity'
  | 'AuthBlocked'
  | 'ReviewRejected'
  | 'Unknown';

export interface RunContext {
  mode: 'live' | 'screenshot';
  browser: string;
  targetUrl: string;
}

export interface RunStep {
  stepId: string;
  nodeType: string;
  action: string;
  target?: string;
  verified: boolean;
  attempts: number;
  startedAt: string;
  endedAt: string;
}

export interface RunFailure {
  code: FailureCode;
  message: string;
  stepId?: string;
  suggestedAction?: string;
}

export interface RunReview {
  decision: ReviewDecision;
  blockerMajorCount: number;
  unresolvedMinorNit: number;
  notes?: string;
}

export interface RunArtifact {
  runId: string;
  workflowId: string;
  status: RunStatus;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  context: RunContext;
  steps: RunStep[];
  failures: RunFailure[];
  review: RunReview;
  evidence: string[];
}
