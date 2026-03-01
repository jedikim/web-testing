import { dirname, resolve } from 'node:path';

import type { CompositeSheetManifest, CompositeSourceImage, MappedCompositeDetection } from '../vision/composite-sheet';
import {
  executeRepeatedItemJudgement,
  type RepeatedItemVlmJudgementResult,
  type RepeatedItemYoloJudgementResult
} from '../vision/repeated-item-judgement';

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

export interface CaptchaYoloDetectionInput {
  step: number;
  goal: string;
  screenshotPath: string;
}

export interface CaptchaYoloDetectionResult {
  detected: boolean;
  confidence?: number;
  label?: string;
}

export interface CaptchaVlmConfirmationInput {
  step: number;
  goal: string;
  screenshotPath: string;
  detection: CaptchaYoloDetectionResult;
}

export interface CaptchaVlmConfirmationResult {
  confirmed: boolean;
  reason?: string;
}

export interface CaptchaLlmSolveInput {
  step: number;
  goal: string;
  screenshotPath: string;
  detection: CaptchaYoloDetectionResult;
  confirmation?: CaptchaVlmConfirmationResult;
  attempt: number;
}

export interface CaptchaLlmSolveResult {
  solved: boolean;
  action?: StepAction;
  reason?: string;
}

export interface ExecuteCaptchaSolveInput {
  step: number;
  goal: string;
  action: StepAction;
  screenshotPath: string;
  attempt: number;
}

export interface VerifyCaptchaClearedInput {
  step: number;
  goal: string;
  screenshotPath: string;
  attempt: number;
}

export interface RepeatedItemTriggerInput {
  step: number;
  goal: string;
  screenshotPath: string;
  reason?: string;
}

export interface RepeatedItemYoloInput {
  step: number;
  goal: string;
  screenshotPath: string;
  compositeImagePath: string;
  manifest: CompositeSheetManifest;
}

export interface RepeatedItemVlmInput {
  step: number;
  goal: string;
  screenshotPath: string;
  compositeImagePath: string;
  manifest: CompositeSheetManifest;
  yolo: RepeatedItemYoloJudgementResult;
  mappedDetections: MappedCompositeDetection[];
}

export interface RepeatedItemYoloAssessmentInput extends RepeatedItemVlmInput {
  compositeImagePath: string;
}

export interface AssistantlessChatE2EInput {
  goal: string;
  maxSteps?: number;
  llmWarmupSteps?: number;
  captchaMaxRetries?: number;
  repeatedItemCompositeRootDir?: string;
  repeatedItemCompositeColumns?: number;
  repeatedItemCompositeCellWidth?: number;
  repeatedItemCompositeCellHeight?: number;
  captureScreenshot: (input: CaptureScreenshotInput) => Promise<string>;
  shareWithUser: (input: ShareSnapshotInput) => Promise<void>;
  analyzeWithLlm: (input: LlmAnalysisInput) => Promise<StepAction>;
  decideWithRules: (input: RuleDecisionInput) => Promise<StepAction>;
  detectWithVision?: (input: VisionHintInput) => Promise<VisionHint>;
  shouldRunRepeatedItemComposite?: (input: RepeatedItemTriggerInput) => Promise<boolean>;
  collectRepeatedItemImages?: (input: RepeatedItemTriggerInput) => Promise<CompositeSourceImage[]>;
  judgeRepeatedItemsWithYolo?: (
    input: RepeatedItemYoloInput
  ) => Promise<RepeatedItemYoloJudgementResult>;
  assessRepeatedItemYolo?: (input: RepeatedItemYoloAssessmentInput) => Promise<{
    accepted: boolean;
    reason?: string;
  }>;
  judgeRepeatedItemsWithVlm?: (
    input: RepeatedItemVlmInput
  ) => Promise<RepeatedItemVlmJudgementResult>;
  detectCaptchaWithYolo?: (
    input: CaptchaYoloDetectionInput
  ) => Promise<CaptchaYoloDetectionResult>;
  confirmCaptchaWithVlm?: (
    input: CaptchaVlmConfirmationInput
  ) => Promise<CaptchaVlmConfirmationResult>;
  solveCaptchaWithLlm?: (input: CaptchaLlmSolveInput) => Promise<CaptchaLlmSolveResult>;
  executeCaptchaSolveAction?: (input: ExecuteCaptchaSolveInput) => Promise<boolean>;
  verifyCaptchaCleared?: (input: VerifyCaptchaClearedInput) => Promise<boolean>;
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
  captchaYoloCalls: number;
  captchaVlmCalls: number;
  captchaLlmSolveCalls: number;
  captchaRetries: number;
  captchaSolved: number;
  captchaFailed: number;
  repeatedItemCompositeBuilds: number;
  repeatedItemCompositeYoloCalls: number;
  repeatedItemCompositeVlmCalls: number;
  repeatedItemCompositeVlmFallbacks: number;
}

function normalizeDecision(decision: LoopDecision): LoopDecision {
  if (decision === 'go' || decision === 'revise' || decision === 'not_go') {
    return decision;
  }
  return 'unknown';
}

function bestMappedDetection(
  detections: MappedCompositeDetection[]
): MappedCompositeDetection | undefined {
  return detections
    .filter((item) => item.matched && item.sourceId)
    .sort((left, right) => (right.confidence ?? 0) - (left.confidence ?? 0))[0];
}

export async function runAssistantlessChatE2E(
  input: AssistantlessChatE2EInput
): Promise<AssistantlessChatE2EOutput> {
  const maxSteps = input.maxSteps ?? 8;
  const llmWarmupSteps = input.llmWarmupSteps ?? 1;
  const captchaMaxRetries = Math.max(1, input.captchaMaxRetries ?? 3);

  let llmCalls = 0;
  let ruleCalls = 0;
  let visionCalls = 0;
  let revisions = 0;
  let snapshotsShared = 0;
  let captchaYoloCalls = 0;
  let captchaVlmCalls = 0;
  let captchaLlmSolveCalls = 0;
  let captchaRetries = 0;
  let captchaSolved = 0;
  let captchaFailed = 0;
  let repeatedItemCompositeBuilds = 0;
  let repeatedItemCompositeYoloCalls = 0;
  let repeatedItemCompositeVlmCalls = 0;
  let repeatedItemCompositeVlmFallbacks = 0;
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

    if (
      input.shouldRunRepeatedItemComposite &&
      input.collectRepeatedItemImages &&
      input.judgeRepeatedItemsWithYolo
    ) {
      const triggerInput: RepeatedItemTriggerInput = {
        step,
        goal: input.goal,
        screenshotPath: beforePath,
        reason: lastFailureReason
      };

      const shouldRun = await input.shouldRunRepeatedItemComposite(triggerInput);
      if (shouldRun) {
        const images = await input.collectRepeatedItemImages(triggerInput);

        if (images.length > 0) {
          const outputRoot = input.repeatedItemCompositeRootDir ?? dirname(beforePath);
          const outputImagePath = resolve(outputRoot, `repeated-items-step-${step + 1}.png`);
          const outputManifestPath = resolve(
            outputRoot,
            `repeated-items-step-${step + 1}.manifest.json`
          );

          const judgement = await executeRepeatedItemJudgement({
            images,
            outputImagePath,
            outputManifestPath,
            columns: input.repeatedItemCompositeColumns,
            cellWidth: input.repeatedItemCompositeCellWidth,
            cellHeight: input.repeatedItemCompositeCellHeight,
            runYolo: async ({ compositeImagePath, manifest }) => {
              repeatedItemCompositeYoloCalls += 1;
              return input.judgeRepeatedItemsWithYolo!({
                step,
                goal: input.goal,
                screenshotPath: beforePath,
                compositeImagePath,
                manifest
              });
            },
            assessYolo: input.assessRepeatedItemYolo
              ? async ({ compositeImagePath, manifest, yolo, mappedDetections }) =>
                  input.assessRepeatedItemYolo!({
                    step,
                    goal: input.goal,
                    screenshotPath: beforePath,
                    compositeImagePath,
                    manifest,
                    yolo,
                    mappedDetections
                  })
              : undefined,
            runVlm: input.judgeRepeatedItemsWithVlm
              ? async ({ compositeImagePath, manifest, yolo, mappedDetections }) => {
                  repeatedItemCompositeVlmCalls += 1;
                  return input.judgeRepeatedItemsWithVlm!({
                    step,
                    goal: input.goal,
                    screenshotPath: beforePath,
                    compositeImagePath,
                    manifest,
                    yolo,
                    mappedDetections
                  });
                }
              : undefined
          });

          repeatedItemCompositeBuilds += 1;
          if (judgement.usedVlmFallback) {
            repeatedItemCompositeVlmFallbacks += 1;
          }

          const bestDetection = bestMappedDetection(judgement.mappedDetections);
          if (bestDetection?.sourceId) {
            pendingVisionHint = {
              model: judgement.usedVlmFallback ? 'vlm-composite' : 'rfdetr-composite',
              target: bestDetection.sourceId,
              confidence: bestDetection.confidence
            };
          }
        }
      }
    }

    if (input.detectCaptchaWithYolo) {
      const detection = await input.detectCaptchaWithYolo({
        step,
        goal: input.goal,
        screenshotPath: beforePath
      });
      captchaYoloCalls += 1;

      if (detection.detected) {
        let confirmation: CaptchaVlmConfirmationResult | undefined;
        if (input.confirmCaptchaWithVlm) {
          confirmation = await input.confirmCaptchaWithVlm({
            step,
            goal: input.goal,
            screenshotPath: beforePath,
            detection
          });
          captchaVlmCalls += 1;
        }

        let cleared = false;
        if (input.solveCaptchaWithLlm) {
          for (let attempt = 1; attempt <= captchaMaxRetries; attempt += 1) {
            captchaRetries += 1;
            const solveResult = await input.solveCaptchaWithLlm({
              step,
              goal: input.goal,
              screenshotPath: beforePath,
              detection,
              confirmation,
              attempt
            });
            captchaLlmSolveCalls += 1;

            if (!solveResult.solved) {
              continue;
            }

            if (solveResult.action && input.executeCaptchaSolveAction) {
              const actionOk = await input.executeCaptchaSolveAction({
                step,
                goal: input.goal,
                action: solveResult.action,
                screenshotPath: beforePath,
                attempt
              });
              if (!actionOk) {
                continue;
              }
            }

            if (input.verifyCaptchaCleared) {
              const verify = await input.verifyCaptchaCleared({
                step,
                goal: input.goal,
                screenshotPath: beforePath,
                attempt
              });
              if (!verify) {
                continue;
              }
            }

            cleared = true;
            captchaSolved += 1;
            break;
          }
        }

        if (!cleared) {
          captchaFailed += 1;
          forceLlm = true;
          lastFailureReason = 'captcha unresolved';

          const decision = normalizeDecision(
            await input.askUserDecision({
              step,
              goal: input.goal,
              screenshotPath: beforePath,
              question: '캡차 자동 해결에 실패했습니다. 계속 진행할까요?'
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
              snapshotsShared,
              captchaYoloCalls,
              captchaVlmCalls,
              captchaLlmSolveCalls,
              captchaRetries,
              captchaSolved,
              captchaFailed,
              repeatedItemCompositeBuilds,
              repeatedItemCompositeYoloCalls,
              repeatedItemCompositeVlmCalls,
              repeatedItemCompositeVlmFallbacks
            };
          }

          if (decision === 'revise') {
            revisions += 1;
          }
        }
      }
    }

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
          snapshotsShared,
          captchaYoloCalls,
          captchaVlmCalls,
          captchaLlmSolveCalls,
          captchaRetries,
          captchaSolved,
          captchaFailed,
          repeatedItemCompositeBuilds,
          repeatedItemCompositeYoloCalls,
          repeatedItemCompositeVlmCalls,
          repeatedItemCompositeVlmFallbacks
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
        snapshotsShared,
        captchaYoloCalls,
        captchaVlmCalls,
        captchaLlmSolveCalls,
        captchaRetries,
        captchaSolved,
        captchaFailed,
        repeatedItemCompositeBuilds,
        repeatedItemCompositeYoloCalls,
        repeatedItemCompositeVlmCalls,
        repeatedItemCompositeVlmFallbacks
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
    snapshotsShared,
    captchaYoloCalls,
    captchaVlmCalls,
    captchaLlmSolveCalls,
    captchaRetries,
    captchaSolved,
    captchaFailed,
    repeatedItemCompositeBuilds,
    repeatedItemCompositeYoloCalls,
    repeatedItemCompositeVlmCalls,
    repeatedItemCompositeVlmFallbacks
  };
}
