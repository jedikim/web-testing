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
    expect(env.llmProvider).toBe('openai');
    expect(env.llmModel).toBe('gpt-5-mini');
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
      /API key is required/
    );
  });

  it('accepts llm config when required values exist', () => {
    const env = loadRuntimeEnv({
      LLM_ENABLED: 'true',
      LLM_API_KEY: 'sk-test',
      LLM_MODEL: 'gpt-5-mini'
    });

    expect(env.llmEnabled).toBe(true);
    expect(env.llmProvider).toBe('openai');
    expect(env.llmApiKey).toBe('sk-test');
    expect(env.llmModel).toBe('gpt-5-mini');
  });

  it('supports gemini key and multiple model options', () => {
    const env = loadRuntimeEnv({
      LLM_ENABLED: 'true',
      LLM_PROVIDER: 'gemini',
      GEMINI_API_KEY: 'gm-test',
      GEMINI_MODELS: 'gemini-3.1-pro-preview,gemini-3-flash-preview',
      LLM_MODEL: 'gemini-3.1-pro-preview'
    });

    expect(env.llmEnabled).toBe(true);
    expect(env.llmProvider).toBe('gemini');
    expect(env.llmApiKey).toBe('gm-test');
    expect(env.llmModelOptions).toContain('gemini-3-flash-preview');
    expect(env.llmModel).toBe('gemini-3.1-pro-preview');
  });
});
