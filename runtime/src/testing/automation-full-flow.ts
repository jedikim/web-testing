import { executeWorkflow, type ExecuteWorkflowResult } from '../engine/deterministic-runner';
import type { DeterministicAdapter } from '../engine/types';
import { executeWithSelectorRecovery, type ExecuteWithSelectorRecoveryInput, type SelectorRecoveryOutput } from '../fallback/auto-recovery';
import { runHumanLoop, type RunHumanLoopInput, type RunHumanLoopOutput } from '../integration/human-loop-runtime';
import type { RunStatus } from '../types';
import { executeWithVisualRecovery, type ExecuteWithVisualRecoveryInput, type VisualRecoveryOutput } from '../vision/visual-recovery';
import type { WorkflowDefinition } from '../workflow/types';

export interface AutomationFullFlowInput {
  workflow: WorkflowDefinition;
  adapter: DeterministicAdapter;
  maxAttemptsPerNode?: number;
  maxTotalSteps?: number;
  selectorRecovery?: ExecuteWithSelectorRecoveryInput;
  visualRecovery?: ExecuteWithVisualRecoveryInput;
  humanLoop?: RunHumanLoopInput;
}

export interface AutomationFullFlowResult {
  finalStatus: RunStatus;
  deterministic: ExecuteWorkflowResult;
  selectorRecovery?: SelectorRecoveryOutput;
  visualRecovery?: VisualRecoveryOutput;
  humanLoop?: RunHumanLoopOutput;
}

function resolveFinalStatus(input: {
  deterministic: ExecuteWorkflowResult;
  selectorRecovery?: SelectorRecoveryOutput;
  visualRecovery?: VisualRecoveryOutput;
  humanLoop?: RunHumanLoopOutput;
}): RunStatus {
  if (input.deterministic.status !== 'pass') {
    return input.deterministic.status;
  }

  if (input.selectorRecovery && input.selectorRecovery.status !== 'pass') {
    return 'fail';
  }

  if (input.visualRecovery && input.visualRecovery.status !== 'pass') {
    return 'fail';
  }

  if (!input.humanLoop) {
    return 'pass';
  }

  if (input.humanLoop.status === 'pass') {
    return 'pass';
  }
  if (input.humanLoop.status === 'fail') {
    return 'fail';
  }
  return 'blocked';
}

export async function runAutomationFullFlow(
  input: AutomationFullFlowInput
): Promise<AutomationFullFlowResult> {
  const deterministic = await executeWorkflow(input.workflow, {
    adapter: input.adapter,
    maxAttemptsPerNode: input.maxAttemptsPerNode,
    maxTotalSteps: input.maxTotalSteps
  });

  if (deterministic.status !== 'pass') {
    return {
      finalStatus: deterministic.status,
      deterministic
    };
  }

  const selectorRecovery = input.selectorRecovery
    ? await executeWithSelectorRecovery(input.selectorRecovery)
    : undefined;

  if (selectorRecovery && selectorRecovery.status !== 'pass') {
    return {
      finalStatus: 'fail',
      deterministic,
      selectorRecovery
    };
  }

  const visualRecovery = input.visualRecovery
    ? await executeWithVisualRecovery(input.visualRecovery)
    : undefined;

  if (visualRecovery && visualRecovery.status !== 'pass') {
    return {
      finalStatus: 'fail',
      deterministic,
      selectorRecovery,
      visualRecovery
    };
  }

  const humanLoop = input.humanLoop ? await runHumanLoop(input.humanLoop) : undefined;

  return {
    finalStatus: resolveFinalStatus({
      deterministic,
      selectorRecovery,
      visualRecovery,
      humanLoop
    }),
    deterministic,
    selectorRecovery,
    visualRecovery,
    humanLoop
  };
}
