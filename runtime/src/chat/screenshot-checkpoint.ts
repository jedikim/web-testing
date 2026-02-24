import type { ChatAdapter, ChatPlatform } from './types';

export type CheckpointDecision = 'go' | 'not_go' | 'revise' | 'unknown';

export interface CheckpointAskInput {
  platform: ChatPlatform;
  channelId: string;
  workflowId: string;
  screenshotPath: string;
  question: string;
}

interface PendingCheckpoint {
  id: string;
  workflowId: string;
  screenshotPath: string;
  question: string;
}

export class ScreenshotCheckpointBroker {
  private readonly adapter: ChatAdapter;
  private readonly pending = new Map<string, PendingCheckpoint>();
  private seq = 0;

  constructor(adapter: ChatAdapter) {
    this.adapter = adapter;
  }

  async ask(input: CheckpointAskInput): Promise<string> {
    this.seq += 1;
    const id = `cp_${this.seq}`;
    const pending: PendingCheckpoint = {
      id,
      workflowId: input.workflowId,
      screenshotPath: input.screenshotPath,
      question: input.question
    };
    this.pending.set(id, pending);

    await this.adapter.send({
      platform: input.platform,
      channelId: input.channelId,
      text: `[${id}] ${input.question}`,
      screenshotPath: input.screenshotPath,
      options: ['go', 'not_go', 'revise']
    });

    return id;
  }

  parseDecision(text: string): CheckpointDecision {
    const normalized = text.trim().toLowerCase();
    if (normalized === 'go' || normalized === '진행' || normalized === 'ok') {
      return 'go';
    }
    if (
      normalized === 'not_go' ||
      normalized === 'not go' ||
      normalized === '중단' ||
      normalized === 'stop'
    ) {
      return 'not_go';
    }
    if (normalized === 'revise' || normalized === '수정' || normalized === 'fix') {
      return 'revise';
    }
    return 'unknown';
  }

  resolve(checkpointId: string): PendingCheckpoint | undefined {
    const row = this.pending.get(checkpointId);
    if (row) {
      this.pending.delete(checkpointId);
    }
    return row;
  }
}
