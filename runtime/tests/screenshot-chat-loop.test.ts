import { describe, expect, it } from 'vitest';

import { runScreenshotChatLoop } from '../src/chat/screenshot-chat-loop';

describe('runScreenshotChatLoop', () => {
  it('completes automation after revise + go conversation', async () => {
    let runCount = 0;
    let revised = false;

    const result = await runScreenshotChatLoop({
      platform: 'slack',
      channelId: 'C1',
      run: async () => {
        runCount += 1;
        if (!revised) {
          return {
            status: 'need_user',
            screenshotPath: `runs/${runCount}.png`,
            question: '이 상태로 진행할까요?'
          };
        }
        return { status: 'pass' };
      },
      askUser: async () => (runCount === 1 ? 'revise' : 'go'),
      reviseWithLlm: async () => {
        revised = true;
      }
    });

    expect(result.status).toBe('pass');
    expect(result.turns).toBeGreaterThanOrEqual(2);
    expect(result.revisions).toBe(1);
  });

  it('stops when user responds not_go', async () => {
    const result = await runScreenshotChatLoop({
      platform: 'telegram',
      channelId: '300',
      run: async () => ({
        status: 'need_user',
        screenshotPath: 'runs/x.png',
        question: '진행?'
      }),
      askUser: async () => 'not_go'
    });

    expect(result.status).toBe('blocked');
  });
});
