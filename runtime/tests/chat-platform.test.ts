import { describe, expect, it } from 'vitest';

import { fromSlackEvent, fromTelegramUpdate } from '../src/chat/platform-normalizer';

describe('chat platform normalizer', () => {
  it('normalizes telegram update payload', () => {
    const inbound = fromTelegramUpdate({
      update_id: 1,
      message: {
        message_id: 10,
        chat: { id: 300, type: 'private' },
        from: { id: 99, is_bot: false, first_name: 'jedi' },
        text: 'go'
      }
    });

    expect(inbound).toEqual({
      platform: 'telegram',
      channelId: '300',
      userId: '99',
      text: 'go'
    });
  });

  it('normalizes slack event payload', () => {
    const inbound = fromSlackEvent({
      type: 'event_callback',
      event: {
        type: 'message',
        user: 'U1',
        channel: 'C1',
        text: 'revise'
      }
    });

    expect(inbound).toEqual({
      platform: 'slack',
      channelId: 'C1',
      userId: 'U1',
      text: 'revise'
    });
  });
});
