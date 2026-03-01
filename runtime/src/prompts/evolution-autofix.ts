import type { VersionedPromptTemplate } from './types';

export interface EvolutionAutofixPromptInput {
  failureLog: string;
}

export const EVOLUTION_AUTOFIX_PROMPT_V1: VersionedPromptTemplate<EvolutionAutofixPromptInput> = {
  id: 'evolution.gemini_autofix',
  version: 'v1',
  render(input) {
    return [
      'You are a coding fixer for a TypeScript repository.',
      'Return only a unified diff in a ```diff fenced block.',
      'Do not include explanations.',
      'Patch must be minimal and safe.',
      'Failure log:',
      input.failureLog
    ].join('\n\n');
  }
};

