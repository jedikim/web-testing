export interface RuntimeEnv {
  nodeEnv: string;
  runKrE2E: boolean;
  playwrightHeadless: boolean;
  playwrightTimeoutMs: number;
  humanLoopMaxTurns: number;
  artifactRoot: string;
  llmEnabled: boolean;
  llmApiKey?: string;
  llmModel?: string;
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

export function loadRuntimeEnv(source: EnvMap = process.env): RuntimeEnv {
  const llmEnabled = parseBoolean(source.LLM_ENABLED, false);
  const llmApiKey = optionalTrim(source.LLM_API_KEY);
  const llmModel = optionalTrim(source.LLM_MODEL);
  const llmBaseUrl = optionalTrim(source.LLM_BASE_URL);

  if (llmEnabled && !llmApiKey) {
    throw new Error('LLM_API_KEY is required when LLM_ENABLED=true');
  }

  return {
    nodeEnv: optionalTrim(source.NODE_ENV) ?? 'development',
    runKrE2E: parseBoolean(source.RUN_KR_E2E, false),
    playwrightHeadless: parseBoolean(source.PW_HEADLESS, true),
    playwrightTimeoutMs: parsePositiveInt(source.PLAYWRIGHT_TIMEOUT_MS, 20000, 'PLAYWRIGHT_TIMEOUT_MS'),
    humanLoopMaxTurns: parsePositiveInt(source.HUMAN_LOOP_MAX_TURNS, 8, 'HUMAN_LOOP_MAX_TURNS'),
    artifactRoot: optionalTrim(source.ARTIFACT_ROOT) ?? 'runs/samples/artifacts',
    llmEnabled,
    llmApiKey,
    llmModel,
    llmBaseUrl
  };
}
