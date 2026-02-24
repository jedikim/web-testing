import { resolveModelFromOptions, type LlmProvider } from '../llm/model-registry';

export interface RuntimeEnv {
  nodeEnv: string;
  runKrE2E: boolean;
  playwrightHeadless: boolean;
  playwrightTimeoutMs: number;
  humanLoopMaxTurns: number;
  artifactRoot: string;
  llmEnabled: boolean;
  llmProvider: LlmProvider;
  llmApiKey?: string;
  llmModel: string;
  llmModelOptions: string[];
  llmBaseUrl?: string;
}

type EnvMap = Record<string, string | undefined>;

function parseBoolean(raw: string | undefined, fallback: boolean): boolean {
  if (raw == null || raw.trim() === '') {
    return fallback;
  }
  const normalized = raw.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function parsePositiveInt(raw: string | undefined, fallback: number, name: string): number {
  if (raw == null || raw.trim() === '') {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive number`);
  }
  return Math.floor(parsed);
}

function optionalTrim(raw: string | undefined): string | undefined {
  if (!raw) {
    return undefined;
  }
  const value = raw.trim();
  return value.length > 0 ? value : undefined;
}

function parseCsv(raw: string | undefined): string[] {
  if (!raw) {
    return [];
  }
  return raw
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

function parseLlmProvider(raw: string | undefined): LlmProvider {
  const provider = (raw?.trim().toLowerCase() ?? 'openai') as LlmProvider;
  if (provider !== 'openai' && provider !== 'gemini') {
    throw new Error(`unsupported LLM_PROVIDER: ${raw}`);
  }
  return provider;
}

function resolveLlmApiKey(provider: LlmProvider, source: EnvMap): string | undefined {
  switch (provider) {
    case 'gemini':
      return optionalTrim(source.GEMINI_API_KEY) ?? optionalTrim(source.LLM_API_KEY);
    case 'openai':
      return optionalTrim(source.OPENAI_API_KEY) ?? optionalTrim(source.LLM_API_KEY);
  }
}

function resolveLlmBaseUrl(provider: LlmProvider, source: EnvMap): string | undefined {
  switch (provider) {
    case 'gemini':
      return optionalTrim(source.GEMINI_BASE_URL) ?? optionalTrim(source.LLM_BASE_URL);
    case 'openai':
      return optionalTrim(source.OPENAI_BASE_URL) ?? optionalTrim(source.LLM_BASE_URL);
  }
}

function resolveLlmModelOptions(provider: LlmProvider, source: EnvMap): string[] {
  switch (provider) {
    case 'gemini':
      return parseCsv(source.GEMINI_MODELS).concat(parseCsv(source.LLM_MODEL_OPTIONS));
    case 'openai':
      return parseCsv(source.OPENAI_MODELS).concat(parseCsv(source.LLM_MODEL_OPTIONS));
  }
}

export function loadRuntimeEnv(source: EnvMap = process.env): RuntimeEnv {
  const llmEnabled = parseBoolean(source.LLM_ENABLED, false);
  const llmProvider = parseLlmProvider(source.LLM_PROVIDER);
  const llmApiKey = resolveLlmApiKey(llmProvider, source);
  const llmBaseUrl = resolveLlmBaseUrl(llmProvider, source);
  const llmModelOptions = resolveLlmModelOptions(llmProvider, source);
  const llmModel = resolveModelFromOptions({
    provider: llmProvider,
    requestedModel: optionalTrim(source.LLM_MODEL),
    modelOptions: llmModelOptions
  });

  if (llmEnabled && !llmApiKey) {
    throw new Error(`API key is required for provider ${llmProvider} when LLM_ENABLED=true`);
  }

  return {
    nodeEnv: optionalTrim(source.NODE_ENV) ?? 'development',
    runKrE2E: parseBoolean(source.RUN_KR_E2E, false),
    playwrightHeadless: parseBoolean(source.PW_HEADLESS, true),
    playwrightTimeoutMs: parsePositiveInt(source.PLAYWRIGHT_TIMEOUT_MS, 20000, 'PLAYWRIGHT_TIMEOUT_MS'),
    humanLoopMaxTurns: parsePositiveInt(source.HUMAN_LOOP_MAX_TURNS, 8, 'HUMAN_LOOP_MAX_TURNS'),
    artifactRoot: optionalTrim(source.ARTIFACT_ROOT) ?? 'runs/samples/artifacts',
    llmEnabled,
    llmProvider,
    llmApiKey,
    llmModel,
    llmModelOptions,
    llmBaseUrl
  };
}
