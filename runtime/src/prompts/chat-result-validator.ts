import type { VersionedPromptTemplate } from './types';

export interface ChatResultValidatorPromptInput {
  userMessage: string;
  extractedSummary: string;
  constraintJson: string;
}

export const CHAT_RESULT_VALIDATOR_PROMPT_V1: VersionedPromptTemplate<ChatResultValidatorPromptInput> = {
  id: 'chat.result_validator',
  version: 'v1',
  render(input) {
    return [
      'You validate whether extracted web-automation result matches user request constraints.',
      'Output ONLY strict JSON. No markdown. No explanation.',
      '',
      'Required output JSON shape:',
      '{',
      '  "valid": true|false,',
      '  "confidence": 0.0-1.0,',
      '  "reason": "short reason",',
      '  "missingConstraints": ["..."],',
      '  "retryHints": ["..."]',
      '}',
      '',
      'Validation policy:',
      '- If product/category/type mismatches, valid=false.',
      '- If request expects apparel/clothing but result is accessory only (e.g., socks, hat, gloves), valid=false.',
      '- If color/budget/gender/category constraints are not satisfied or unclear, valid=false.',
      '- If evidence is insufficient, prefer valid=false with clear missing constraints.',
      '- Keep retry hints short and actionable.',
      '',
      `User message: ${input.userMessage}`,
      `Constraint JSON: ${input.constraintJson}`,
      '',
      'Extracted summary:',
      input.extractedSummary
    ].join('\n');
  }
};
