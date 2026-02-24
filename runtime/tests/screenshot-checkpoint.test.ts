import { describe, expect, it } from 'vitest';

import { ScreenshotCheckpointBroker } from '../src/chat/screenshot-checkpoint';
import type { ChatAdapter, ChatOutbound } from '../src/chat/types';

class FakeChatAdapter implements ChatAdapter {
  public readonly sent: ChatOutbound[] = [];

  async send(message: ChatOutbound): Promise<void> {
    this.sent.push(message);
  }
}

describe('ScreenshotCheckpointBroker', () => {
  it('sends screenshot question to channel and records pending checkpoint', async () => {
    const adapter = new FakeChatAdapter();
    const broker = new ScreenshotCheckpointBroker(adapter);

    const id = await broker.ask({
      platform: 'telegram',
      channelId: '300',
      workflowId: 'shopping_search_v01',
      screenshotPath: 'runs/s1.png',
      question: '진행할까요?'
    });

    expect(id).toBeTruthy();
    expect(adapter.sent).toHaveLength(1);
    expect(adapter.sent[0]).toMatchObject({
      platform: 'telegram',
      channelId: '300'
    });
    expect(adapter.sent[0]?.screenshotPath).toBe('runs/s1.png');
  });

  it('maps chat response text to go/not_go/revise decisions', () => {
    const adapter = new FakeChatAdapter();
    const broker = new ScreenshotCheckpointBroker(adapter);

    expect(broker.parseDecision('go')).toBe('go');
    expect(broker.parseDecision('not go')).toBe('not_go');
    expect(broker.parseDecision('수정')).toBe('revise');
    expect(broker.parseDecision('???')).toBe('unknown');
  });
});
