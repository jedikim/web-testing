import type { RunFailure, RunStatus } from '../types';

import type { ApproveEvolutionJobInput, CreateEvolutionJobInput, EvolutionTrigger, JobProgressSnapshot } from './types';
import type { EvolutionService } from './service';

export interface EvolutionController {
  createJob(input: CreateEvolutionJobInput): Promise<JobProgressSnapshot>;
  waitForCompletion(jobId: string): Promise<JobProgressSnapshot>;
  approveJob(jobId: string, input: ApproveEvolutionJobInput): Promise<JobProgressSnapshot>;
}

export interface AutoImprovementOutcomeInput {
  workflowId: string;
  status: RunStatus;
  failures: RunFailure[];
  sourceRunPath?: string;
  notes?: string;
  title?: string;
  requestedBy?: string;
}

export interface AutoImprovementOptions {
  enabled?: boolean;
  triggerStatuses?: RunStatus[];
  autoApprove?: boolean | ((snapshot: JobProgressSnapshot) => Promise<boolean> | boolean);
  autoApproveBy?: string;
  autoApproveNote?: string;
  baseBranch?: string;
  testCommand?: string;
  maxAutoFixAttempts?: number;
}

export interface AutoImprovementResult {
  triggered: boolean;
  reason?: string;
  created?: JobProgressSnapshot;
  completed?: JobProgressSnapshot;
  approved?: JobProgressSnapshot;
}

const DEFAULT_TRIGGER_STATUSES: RunStatus[] = ['fail'];

function inferTriggerFromFailures(failures: RunFailure[]): EvolutionTrigger {
  const codes = new Set(failures.map((failure) => failure.code));
  if (
    codes.has('SelectorNotFound') ||
    codes.has('VisualAmbiguity') ||
    codes.has('AuthBlocked')
  ) {
    return 'exception';
  }
  return 'bug';
}

function defaultTitle(workflowId: string, trigger: EvolutionTrigger): string {
  return `auto-improvement ${trigger} for ${workflowId}`;
}

function asController(service: EvolutionService): EvolutionController {
  return {
    createJob: (input) => service.createJob(input),
    waitForCompletion: (jobId) => service.waitForCompletion(jobId),
    approveJob: (jobId, input) => service.approveJob(jobId, input)
  };
}

export class AutoImprovementOrchestrator {
  private readonly controller: EvolutionController;
  private readonly options: AutoImprovementOptions;

  constructor(controller: EvolutionController, options: AutoImprovementOptions = {}) {
    this.controller = controller;
    this.options = options;
  }

  static fromEvolutionService(
    service: EvolutionService,
    options: AutoImprovementOptions = {}
  ): AutoImprovementOrchestrator {
    return new AutoImprovementOrchestrator(asController(service), options);
  }

  private isEnabled(): boolean {
    return this.options.enabled ?? true;
  }

  private triggerStatuses(): RunStatus[] {
    return this.options.triggerStatuses ?? DEFAULT_TRIGGER_STATUSES;
  }

  private async shouldAutoApprove(snapshot: JobProgressSnapshot): Promise<boolean> {
    const setting = this.options.autoApprove ?? false;
    if (typeof setting === 'function') {
      return setting(snapshot);
    }
    return setting;
  }

  async handleOutcome(input: AutoImprovementOutcomeInput): Promise<AutoImprovementResult> {
    if (!this.isEnabled()) {
      return {
        triggered: false,
        reason: 'auto improvement is disabled'
      };
    }

    if (!this.triggerStatuses().includes(input.status)) {
      return {
        triggered: false,
        reason: `status ${input.status} is outside trigger statuses`
      };
    }

    const trigger = inferTriggerFromFailures(input.failures);

    const created = await this.controller.createJob({
      title: input.title ?? defaultTitle(input.workflowId, trigger),
      trigger,
      workflowId: input.workflowId,
      sourceRunPath: input.sourceRunPath,
      notes: input.notes,
      requestedBy: input.requestedBy,
      baseBranch: this.options.baseBranch,
      testCommand: this.options.testCommand,
      maxAutoFixAttempts: this.options.maxAutoFixAttempts
    });

    const completed = await this.controller.waitForCompletion(created.job.id);

    if (completed.job.status !== 'awaiting_approval') {
      return {
        triggered: true,
        created,
        completed
      };
    }

    const autoApprove = await this.shouldAutoApprove(completed);
    if (!autoApprove) {
      return {
        triggered: true,
        created,
        completed
      };
    }

    const approved = await this.controller.approveJob(completed.job.id, {
      confirmedBy: this.options.autoApproveBy ?? 'auto-improvement-orchestrator',
      note: this.options.autoApproveNote ?? 'Auto-approved by policy'
    });

    return {
      triggered: true,
      created,
      completed,
      approved
    };
  }
}
