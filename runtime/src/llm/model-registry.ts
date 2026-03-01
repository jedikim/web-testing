export type LlmProvider = 'gemini' | 'openai';

const SUPPORTED_MODELS: Record<LlmProvider, string[]> = {
  gemini: ['gemini-3.1-pro-preview', 'gemini-3-flash-preview'],
  openai: ['gpt-5-codex', 'gpt-5-mini']
};

const DEFAULT_MODEL: Record<LlmProvider, string> = {
  gemini: 'gemini-3-flash-preview',
  openai: 'gpt-5-mini'
};

export interface ResolveModelInput {
  provider: LlmProvider;
  requestedModel?: string;
  modelOptions?: string[];
}

function normalizeOptions(options?: string[]): string[] {
  if (!options) {
    return [];
  }
  return options.map((value) => value.trim()).filter((value) => value.length > 0);
}

export function listSupportedModelIds(provider: LlmProvider): string[] {
  return [...SUPPORTED_MODELS[provider]];
}

export function defaultModelFor(provider: LlmProvider): string {
  return DEFAULT_MODEL[provider];
}

export function resolveModelFromOptions(input: ResolveModelInput): string {
  const requested = input.requestedModel?.trim();
  const options = normalizeOptions(input.modelOptions);

  if (options.length > 0) {
    if (requested && !options.includes(requested)) {
      throw new Error(
        `requested model "${requested}" is not in allowed model options: ${options.join(', ')}`
      );
    }
    return requested ?? options[0]!;
  }

  if (requested) {
    return requested;
  }

  return defaultModelFor(input.provider);
}
