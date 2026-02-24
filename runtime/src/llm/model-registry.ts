export type LlmProvider = 'gemini' | 'openai' | 'anthropic' | 'openai_compatible';

const SUPPORTED_MODELS: Record<Exclude<LlmProvider, 'openai_compatible'>, string[]> = {
  gemini: ['gemini-3.0-flash', 'gemini-2.0-flash', 'gemini-2.0-flash-lite', 'gemini-1.5-pro'],
  openai: ['gpt-4.1-mini', 'gpt-4o-mini', 'gpt-4.1'],
  anthropic: ['claude-3-5-haiku-latest', 'claude-3-5-sonnet-latest', 'claude-3-opus-latest']
};

const DEFAULT_MODEL: Record<LlmProvider, string> = {
  gemini: 'gemini-3.0-flash',
  openai: 'gpt-4.1-mini',
  anthropic: 'claude-3-5-haiku-latest',
  openai_compatible: 'gpt-4.1-mini'
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
  if (provider === 'openai_compatible') {
    return [...SUPPORTED_MODELS.openai];
  }
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
