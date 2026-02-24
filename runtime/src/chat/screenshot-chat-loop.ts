import type { ChatPlatform } from './types';
import type { CheckpointDecision } from './screenshot-checkpoint';

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
  const maxTurns = input.maxTurns ?? 8;
  let turns = 0;
  let revisions = 0;
  const decisions: CheckpointDecision[] = [];

  while (turns < maxTurns) {
    turns += 1;
    const result = await input.run();

    if (result.status === 'pass') {
      return { status: 'pass', turns, revisions, decisions };
    }
    if (result.status === 'fail') {
      return { status: 'fail', turns, revisions, decisions };
    }

    const decision = await input.askUser({
      platform: input.platform,
      channelId: input.channelId,
      screenshotPath: result.screenshotPath,
      question: result.question
    });
    decisions.push(decision);

    if (decision === 'not_go' || decision === 'unknown') {
      return { status: 'blocked', turns, revisions, decisions };
    }

    if (decision === 'revise') {
      if (input.reviseWithLlm) {
        await input.reviseWithLlm();
      }
      revisions += 1;
      continue;
    }
  }

  return { status: 'blocked', turns, revisions, decisions };
}
