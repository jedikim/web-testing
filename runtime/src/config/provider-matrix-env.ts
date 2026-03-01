import type { LlmProvider } from '../llm/model-registry';

type EnvMap = Record<string, string | undefined>;

export interface LlmProviderTarget {
  provider: LlmProvider;
  apiKey: string;
  baseUrl?: string;
  models: string[];
}

export interface VisionProviderTarget {
  provider: 'rfdetr';
  apiKey?: string;
  baseUrl: string;
  models: string[];
}

export interface ProviderMatrixEnv {
  llmTargets: LlmProviderTarget[];
  visionTargets: VisionProviderTarget[];
}

const VALID_LLM_VENDORS = new Set(['gemini', 'openai']);

function trim(raw: string | undefined): string | undefined {
  if (!raw) {
    return undefined;
  }
  const value = raw.trim();
  return value.length > 0 ? value : undefined;
}

function parseBoolean(raw: string | undefined): boolean {
  const normalized = raw?.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function parseCsv(raw: string | undefined): string[] {
  if (!raw) {
    return [];
  }
  return raw
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function vendorKey(provider: LlmProvider, env: EnvMap): string | undefined {
  switch (provider) {
    case 'gemini':
      return trim(env.GEMINI_API_KEY);
    case 'openai':
      return trim(env.OPENAI_API_KEY);
  }
}

function vendorModels(provider: LlmProvider, env: EnvMap): string[] {
  switch (provider) {
    case 'gemini':
      return parseCsv(env.GEMINI_MODELS);
    case 'openai':
      return parseCsv(env.OPENAI_MODELS);
  }
}

function vendorBaseUrl(
  provider: LlmProvider,
  env: EnvMap
): string | undefined {
  switch (provider) {
    case 'gemini':
      return trim(env.GEMINI_BASE_URL);
    case 'openai':
      return trim(env.OPENAI_BASE_URL);
  }
}

export function loadProviderMatrixEnv(source: EnvMap = process.env): ProviderMatrixEnv {
  const order = parseCsv(source.LLM_VENDOR_ORDER);
  const orderedVendors = (order.length > 0 ? order : ['gemini', 'openai']).filter(
    (vendor, index, list) =>
      VALID_LLM_VENDORS.has(vendor) && list.findIndex((value) => value === vendor) === index
  ) as LlmProvider[];

  const llmTargets: LlmProviderTarget[] = [];
  for (const provider of orderedVendors) {
    const apiKey = vendorKey(provider, source);
    const models = vendorModels(provider, source);
    if (!apiKey || models.length === 0) {
      continue;
    }
    llmTargets.push({
      provider,
      apiKey,
      baseUrl: vendorBaseUrl(provider, source),
      models
    });
  }

  const visionTargets: VisionProviderTarget[] = [];
  if (parseBoolean(source.RFDETR_ENABLED)) {
    const apiKey = trim(source.RFDETR_API_KEY);
    const baseUrl = trim(source.RFDETR_BASE_URL);
    if (!baseUrl) {
      throw new Error('RFDETR_BASE_URL is required when RFDETR_ENABLED=1');
    }
    const models = parseCsv(source.RFDETR_MODELS);
    if (models.length === 0) {
      throw new Error('RFDETR_MODELS must include at least one model when RFDETR_ENABLED=1');
    }
    visionTargets.push({
      provider: 'rfdetr',
      apiKey,
      baseUrl,
      models
    });
  }

  return {
    llmTargets,
    visionTargets
  };
}
