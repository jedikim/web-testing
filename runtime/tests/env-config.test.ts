import { describe, expect, it } from 'vitest';

import { loadRuntimeEnv } from '../src/config/env';

describe('loadRuntimeEnv', () => {
  it('uses safe defaults with empty env', () => {
    const env = loadRuntimeEnv({});

    expect(env.runKrE2E).toBe(false);
    expect(env.playwrightHeadless).toBe(true);
    expect(env.playwrightTimeoutMs).toBe(20000);
    expect(env.humanLoopMaxTurns).toBe(8);
    expect(env.llmEnabled).toBe(false);
  });

  it('parses flags and numeric values', () => {
    const env = loadRuntimeEnv({
      RUN_KR_E2E: '1',
      PW_HEADLESS: 'false',
      PLAYWRIGHT_TIMEOUT_MS: '45000',
      HUMAN_LOOP_MAX_TURNS: '12'
    });

    expect(env.runKrE2E).toBe(true);
    expect(env.playwrightHeadless).toBe(false);
    expect(env.playwrightTimeoutMs).toBe(45000);
    expect(env.humanLoopMaxTurns).toBe(12);
  });

  it('requires llm key when llm is enabled', () => {
    expect(() => loadRuntimeEnv({ LLM_ENABLED: 'true' })).toThrow(
      /LLM_API_KEY is required/
    );
  });

  it('accepts llm config when required values exist', () => {
    const env = loadRuntimeEnv({
      LLM_ENABLED: 'true',
      LLM_API_KEY: 'sk-test',
      LLM_MODEL: 'gpt-4.1-mini'
    });

    expect(env.llmEnabled).toBe(true);
    expect(env.llmApiKey).toBe('sk-test');
    expect(env.llmModel).toBe('gpt-4.1-mini');
  });
});
