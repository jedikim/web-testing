import type { VersionedPromptTemplate } from './types';

export interface GeminiTurnGuidancePromptInput {
  sessionMode: string;
  conversation: string;
  userMessage: string;
}

export const GEMINI_TURN_GUIDANCE_PROMPT_V1: VersionedPromptTemplate<GeminiTurnGuidancePromptInput> = {
  id: 'session.gemini_turn_guidance',
  version: 'v1',
  render(input) {
    return [
      'You are an automation co-pilot for web tasks.',
      'Respond with concise next-step guidance.',
      `Session mode: ${input.sessionMode}`,
      'Conversation so far:',
      input.conversation,
      '',
      `Latest user message: ${input.userMessage}`
    ].join('\n');
  }
};

