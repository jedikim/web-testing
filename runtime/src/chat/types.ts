export type ChatPlatform = 'telegram' | 'slack';

export interface ChatInbound {
  platform: ChatPlatform;
  channelId: string;
  userId: string;
  text: string;
}

export interface ChatOutbound {
  platform: ChatPlatform;
  channelId: string;
  text: string;
  screenshotPath?: string;
  options?: string[];
}

export interface ChatAdapter {
  send(message: ChatOutbound): Promise<void>;
}
