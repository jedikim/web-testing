import type { AutomationFullFlowInput, AutomationFullFlowResult } from '../testing/automation-full-flow';
import { runAutomationFullFlow } from '../testing/automation-full-flow';
import type { RunFailure } from '../types';
import {
  type AutoImprovementOutcomeInput,
  type AutoImprovementResult
} from '../evolution/auto-improvement-orchestrator';

export interface RunWithImprovementMetadata {
  sourceRunPath?: string;
  notes?: string;
  title?: string;
  requestedBy?: string;
}

export interface RunWithImprovementInput extends AutomationFullFlowInput {
  improvement?: RunWithImprovementMetadata;
}

export interface WebAutomationSdkOptions {
  runner?: (input: AutomationFullFlowInput) => Promise<AutomationFullFlowResult>;
  autoImprovement?: AutoImprovementHandler;
  includeBlockedAsFailure?: boolean;
}

export interface RunWithImprovementOutput {
  flow: AutomationFullFlowResult;
  improvement?: AutoImprovementResult;
}

export interface AutoImprovementHandler {
  handleOutcome: (input: AutoImprovementOutcomeInput) => Promise<AutoImprovementResult>;
}

function failureList(flow: AutomationFullFlowResult): RunFailure[] {
  const failures = [...flow.deterministic.failures];

  if (flow.selectorRecovery && flow.selectorRecovery.status !== 'pass') {
    failures.push({
      code: 'SelectorNotFound',
      message: 'selector recovery did not resolve the failure'
    });
  }

  if (flow.visualRecovery && flow.visualRecovery.status !== 'pass') {
    failures.push({
      code: 'VisualAmbiguity',
      message: 'visual recovery did not resolve the failure'
    });
  }

  if (flow.humanLoop?.status === 'fail') {
    failures.push({
      code: 'ExpectationFailed',
      message: 'human loop run failed'
    });
  }

  if (flow.humanLoop?.status === 'blocked') {
    failures.push({
      code: 'AuthBlocked',
      message: 'human loop blocked by policy decision'
    });
  }

  if (failures.length === 0 && flow.finalStatus === 'fail') {
    failures.push({
      code: 'Unknown',
      message: 'flow failed with no explicit failure code'
    });
  }

  return failures;
}

export class WebAutomationSdk {
  private readonly runner: (input: AutomationFullFlowInput) => Promise<AutomationFullFlowResult>;
  private readonly autoImprovement?: AutoImprovementHandler;
  private readonly includeBlockedAsFailure: boolean;

  constructor(options: WebAutomationSdkOptions = {}) {
    this.runner = options.runner ?? runAutomationFullFlow;
    this.autoImprovement = options.autoImprovement;
    this.includeBlockedAsFailure = options.includeBlockedAsFailure ?? false;
  }

  async run(input: AutomationFullFlowInput): Promise<AutomationFullFlowResult> {
    return this.runner(input);
  }

  async runWithImprovement(input: RunWithImprovementInput): Promise<RunWithImprovementOutput> {
    const flow = await this.runner(input);

    if (!this.autoImprovement) {
      return { flow };
    }

    const shouldTrigger =
      flow.finalStatus === 'fail' ||
      (this.includeBlockedAsFailure && flow.finalStatus === 'blocked');

    if (!shouldTrigger) {
      return {
        flow,
        improvement: {
          triggered: false,
          reason: `final status is ${flow.finalStatus}`
        }
      };
    }

    const improvement = await this.autoImprovement.handleOutcome({
      workflowId: input.workflow.workflowId,
      status: flow.finalStatus,
      failures: failureList(flow),
      sourceRunPath: input.improvement?.sourceRunPath,
      notes: input.improvement?.notes,
      title: input.improvement?.title,
      requestedBy: input.improvement?.requestedBy
    });

    return {
      flow,
      improvement
    };
  }
}

export function createWebAutomationSdk(options: WebAutomationSdkOptions = {}): WebAutomationSdk {
  return new WebAutomationSdk(options);
}
