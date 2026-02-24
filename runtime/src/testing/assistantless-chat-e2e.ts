export type LoopDecision = 'go' | 'not_go' | 'revise' | 'unknown';

export interface StepAction {
  kind: string;
  target?: string;
  value?: string;
}

export interface VisionHint {
  model?: string;
  target?: string;
  confidence?: number;
}

export interface ExecuteActionResult {
  status: 'pass' | 'fail';
  done?: boolean;
  reason?: string;
  userQuestion?: string;
}

export interface CaptureScreenshotInput {
  step: number;
  stage: 'before' | 'after';
}

export interface ShareSnapshotInput {
  step: number;
  stage: 'before' | 'after';
  screenshotPath: string;
  goal: string;
  status?: 'pass' | 'fail';
  message: string;
}

export interface LlmAnalysisInput {
  step: number;
  goal: string;
  screenshotPath: string;
  reason?: string;
}

export interface RuleDecisionInput {
  step: number;
  goal: string;
  screenshotPath: string;
}

export interface VisionHintInput {
  step: number;
  goal: string;
  screenshotPath: string;
  reason: string;
}

export interface ExecuteStepInput {
  step: number;
  goal: string;
  action: StepAction;
  visionHint?: VisionHint;
}

export interface AskDecisionInput {
  step: number;
  goal: string;
  screenshotPath: string;
  question: string;
}

export interface AssistantlessChatE2EInput {
  goal: string;
  maxSteps?: number;
  llmWarmupSteps?: number;
  captureScreenshot: (input: CaptureScreenshotInput) => Promise<string>;
  shareWithUser: (input: ShareSnapshotInput) => Promise<void>;
  analyzeWithLlm: (input: LlmAnalysisInput) => Promise<StepAction>;
  decideWithRules: (input: RuleDecisionInput) => Promise<StepAction>;
  detectWithVision?: (input: VisionHintInput) => Promise<VisionHint>;
  executeAction: (input: ExecuteStepInput) => Promise<ExecuteActionResult>;
  askUserDecision: (input: AskDecisionInput) => Promise<LoopDecision>;
}

export interface AssistantlessChatE2EOutput {
  status: 'pass' | 'fail' | 'blocked';
  steps: number;
  llmCalls: number;
  ruleCalls: number;
  visionCalls: number;
  revisions: number;
  decisions: LoopDecision[];
  snapshotsShared: number;
}

function normalizeDecision(decision: LoopDecision): LoopDecision {
  if (decision === 'go' || decision === 'revise' || decision === 'not_go') {
    return decision;
  }
  return 'unknown';
}

export async function runAssistantlessChatE2E(
  input: AssistantlessChatE2EInput
): Promise<AssistantlessChatE2EOutput> {
  const maxSteps = input.maxSteps ?? 8;
  const llmWarmupSteps = input.llmWarmupSteps ?? 1;

  let llmCalls = 0;
  let ruleCalls = 0;
  let visionCalls = 0;
  let revisions = 0;
  let snapshotsShared = 0;
  let forceLlm = false;
  let lastFailureReason: string | undefined;
  let pendingVisionHint: VisionHint | undefined;
  const decisions: LoopDecision[] = [];

  for (let step = 0; step < maxSteps; step += 1) {
    const beforePath = await input.captureScreenshot({ step, stage: 'before' });
    await input.shareWithUser({
      step,
      stage: 'before',
      screenshotPath: beforePath,
      goal: input.goal,
      message: `step ${step + 1} 시작 전 상태 공유`
    });
    snapshotsShared += 1;

    const useLlm = step < llmWarmupSteps || forceLlm;
    const action = useLlm
      ? await input.analyzeWithLlm({
          step,
          goal: input.goal,
          screenshotPath: beforePath,
          reason: lastFailureReason
        })
      : await input.decideWithRules({
          step,
          goal: input.goal,
          screenshotPath: beforePath
        });
    if (useLlm) {
      llmCalls += 1;
    } else {
      ruleCalls += 1;
    }

    const actionResult = await input.executeAction({
      step,
      goal: input.goal,
      action,
      visionHint: pendingVisionHint
    });
    pendingVisionHint = undefined;

    const afterPath = await input.captureScreenshot({ step, stage: 'after' });
    await input.shareWithUser({
      step,
      stage: 'after',
      screenshotPath: afterPath,
      goal: input.goal,
      status: actionResult.status,
      message:
        actionResult.status === 'pass'
          ? `step ${step + 1} 실행 성공`
          : `step ${step + 1} 실행 실패: ${actionResult.reason ?? 'unknown'}`
    });
    snapshotsShared += 1;

    if (actionResult.status === 'pass') {
      forceLlm = false;
      lastFailureReason = undefined;
      if (actionResult.done) {
        return {
          status: 'pass',
          steps: step + 1,
          llmCalls,
          ruleCalls,
          visionCalls,
          revisions,
          decisions,
          snapshotsShared
        };
      }
      continue;
    }

    lastFailureReason = actionResult.reason ?? 'unknown failure';
    if (input.detectWithVision) {
      pendingVisionHint = await input.detectWithVision({
        step,
        goal: input.goal,
        screenshotPath: afterPath,
        reason: lastFailureReason
      });
      visionCalls += 1;
    }

    forceLlm = true;
    const decision = normalizeDecision(
      await input.askUserDecision({
        step,
        goal: input.goal,
        screenshotPath: afterPath,
        question: actionResult.userQuestion ?? '실패가 발생했습니다. 진행할까요?'
      })
    );
    decisions.push(decision);

    if (decision === 'not_go' || decision === 'unknown') {
      return {
        status: 'blocked',
        steps: step + 1,
        llmCalls,
        ruleCalls,
        visionCalls,
        revisions,
        decisions,
        snapshotsShared
      };
    }

    if (decision === 'revise') {
      revisions += 1;
    }
  }

  return {
    status: 'fail',
    steps: maxSteps,
    llmCalls,
    ruleCalls,
    visionCalls,
    revisions,
    decisions,
    snapshotsShared
  };
}
