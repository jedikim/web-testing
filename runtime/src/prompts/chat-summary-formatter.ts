import type { VersionedPromptTemplate } from './types';

export interface ChatSummaryFormatterPromptInput {
  taskContent: string;
  rawSummary: string;
  maxItems: number;
}

export const CHAT_SUMMARY_FORMATTER_PROMPT_V1: VersionedPromptTemplate<ChatSummaryFormatterPromptInput> = {
  id: 'chat.summary_formatter',
  version: 'v1',
  render(input) {
    return [
      'You are a web-automation result formatter.',
      'Rewrite the raw extraction into concise Korean.',
      'Rules:',
      '- Do not invent facts.',
      `- Keep at most ${input.maxItems} items.`,
      '- For shopping listing rows, include: 제품명 / 일시불 / 할부(월x개월=총액) / 가격기준.',
      '- If price data is missing, explicitly write "정보 없음".',
      '- Keep output structured and easy to read.',
      '',
      `User request: ${input.taskContent}`,
      '',
      'Raw extraction:',
      input.rawSummary
    ].join('\n');
  }
};

