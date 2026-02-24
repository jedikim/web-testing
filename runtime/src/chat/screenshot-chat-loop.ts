import type { CheckpointDecision } from './screenshot-checkpoint';
import { runHumanLoop } from '../integration/human-loop-runtime';
import type { ChatPlatform } from './types';

export interface ScreenshotChatRunResult {
  status: 'pass' | 'fail' | 'need_user';
  reason?: string;
  screenshotPath?: string;
  question?: string;
}

export interface ScreenshotChatLoopInput {
  platform: ChatPlatform;
  channelId: string;
  run: () => Promise<ScreenshotChatRunResult>;
  askUser: (input: {
    platform: ChatPlatform;
    channelId: string;
    screenshotPath?: string;
    question?: string;
  }) => Promise<CheckpointDecision>;
  reviseWithLlm?: () => Promise<void>;
  maxTurns?: number;
}

export interface ScreenshotChatLoopOutput {
  status: 'pass' | 'fail' | 'blocked';
  turns: number;
  revisions: number;
  decisions: CheckpointDecision[];
}

export async function runScreenshotChatLoop(
  input: ScreenshotChatLoopInput
): Promise<ScreenshotChatLoopOutput> {
  const result = await runHumanLoop({
    workflowId: `${input.platform}:${input.channelId}`,
    run: input.run,
    decisionPort: {
      requestDecision: async (request): Promise<CheckpointDecision> =>
        input.askUser({
          platform: input.platform,
          channelId: input.channelId,
          screenshotPath: request.screenshotPath,
          question: request.question
        })
    },
    reviseWithLlm: input.reviseWithLlm,
    maxTurns: input.maxTurns
  });

  return {
    status: result.status,
    turns: result.turns,
    revisions: result.revisions,
    decisions: result.decisions
  };
}
