import type { ChatInbound } from './types';

interface TelegramUpdate {
  update_id?: number;
  message?: {
    message_id?: number;
    chat?: { id?: number | string; type?: string; [key: string]: unknown };
    from?: { id?: number | string; is_bot?: boolean; first_name?: string; [key: string]: unknown };
    text?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

interface SlackEventPayload {
  type?: string;
  event?: {
    type?: string;
    user?: string;
    channel?: string;
    text?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export function fromTelegramUpdate(update: TelegramUpdate): ChatInbound | undefined {
  const message = update.message;
  if (!message?.text || message.chat?.id == null || message.from?.id == null) {
    return undefined;
  }

  return {
    platform: 'telegram',
    channelId: String(message.chat.id),
    userId: String(message.from.id),
    text: message.text
  };
}

export function fromSlackEvent(payload: SlackEventPayload): ChatInbound | undefined {
  const event = payload.event;
  if (event?.type !== 'message' || !event.user || !event.channel || !event.text) {
    return undefined;
  }

  return {
    platform: 'slack',
    channelId: event.channel,
    userId: event.user,
    text: event.text
  };
}
