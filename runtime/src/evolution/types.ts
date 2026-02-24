export type EvolutionTrigger = 'bug' | 'exception';

export type EvolutionStatus =
  | 'draft'
  | 'sandbox_prepared'
  | 'testing'
  | 'auto_fixing'
  | 'awaiting_approval'
  | 'promoted'
  | 'rejected'
  | 'failed';

export interface EvolutionModelPolicy {
  codingModel: string;
  automationModel: string;
}

export interface EvolutionTestAttempt {
  attempt: number;
  startedAt: string;
  endedAt: string;
  ok: boolean;
  exitCode: number;
  outputPath: string;
  autoFixNotePath?: string;
}

export interface EvolutionCandidateVersion {
  version: number;
  branchName: string;
  baseBranch: string;
  worktreePath: string;
  scenarioPackPath: string;
  attempts: number;
  testAttempts: EvolutionTestAttempt[];
}

export type EvolutionChangeCategory = 'feature' | 'exception' | 'bugfix' | 'ops';

export interface EvolutionChangeLogEntry {
  at: string;
  category: EvolutionChangeCategory;
  summary: string;
  details?: string;
}

export interface EvolutionJob {
  id: string;
  title: string;
  trigger: EvolutionTrigger;
  workflowId: string;
  sourceRunPath?: string;
  notes?: string;
  status: EvolutionStatus;
  requestedBy: string;
  createdAt: string;
  updatedAt: string;
  modelPolicy: EvolutionModelPolicy;
  baseBranch: string;
  testCommand: string;
  maxAutoFixAttempts: number;
  currentVersion: number;
  candidate?: EvolutionCandidateVersion;
  lastError?: string;
  changelog: EvolutionChangeLogEntry[];
}

export interface EvolutionEvent {
  at: string;
  stage: EvolutionStatus | 'created' | 'scenario_pack' | 'promotion';
  message: string;
  details?: string;
}

export interface CreateEvolutionJobInput {
  title: string;
  trigger: EvolutionTrigger;
  workflowId: string;
  requestedBy?: string;
  sourceRunPath?: string;
  notes?: string;
  baseBranch?: string;
  testCommand?: string;
  maxAutoFixAttempts?: number;
}

export interface ApproveEvolutionJobInput {
  confirmedBy: string;
  note?: string;
}

export interface RejectEvolutionJobInput {
  rejectedBy: string;
  reason?: string;
}

export interface ActiveVersionPointer {
  workflowId: string;
  jobId: string;
  version: number;
  branchName: string;
  worktreePath: string;
  promotedAt: string;
  confirmedBy: string;
}

export interface JobProgressSnapshot {
  job: EvolutionJob;
  events: EvolutionEvent[];
  activeVersion?: ActiveVersionPointer;
}
