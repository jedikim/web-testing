import { describe, expect, it } from 'vitest';

import { loadProviderMatrixEnv } from '../src/config/provider-matrix-env';

describe('loadProviderMatrixEnv', () => {
  it('parses multi-vendor llm + rfdetr model matrix from env', () => {
    const config = loadProviderMatrixEnv({
      LLM_VENDOR_ORDER: 'gemini,openai',
      GEMINI_API_KEY: 'gm-key',
      GEMINI_MODELS: 'gemini-3.1-pro-preview,gemini-3-flash-preview',
      OPENAI_API_KEY: 'oa-key',
      OPENAI_MODELS: 'gpt-5-codex,gpt-5-mini',
      RFDETR_ENABLED: '1',
      RFDETR_API_KEY: 'yo-key',
      RFDETR_BASE_URL: 'https://vision.example.local',
      RFDETR_MODELS: 'rf-detr-medium'
    });

    expect(config.llmTargets).toHaveLength(2);
    expect(config.llmTargets[0]?.provider).toBe('gemini');
    expect(config.llmTargets[1]?.provider).toBe('openai');
    expect(config.llmTargets[0]?.models).toEqual(['gemini-3.1-pro-preview', 'gemini-3-flash-preview']);
    expect(config.visionTargets).toEqual([
      {
        provider: 'rfdetr',
        apiKey: 'yo-key',
        baseUrl: 'https://vision.example.local',
        models: ['rf-detr-medium']
      }
    ]);
  });

  it('throws when rfdetr is enabled but required env is missing', () => {
    expect(() =>
      loadProviderMatrixEnv({
        RFDETR_ENABLED: '1',
        RFDETR_API_KEY: 'yo-key'
      })
    ).toThrow(/RFDETR_BASE_URL is required/);
  });

  it('allows rfdetr without api key for local open-source endpoint', () => {
    const config = loadProviderMatrixEnv({
      RFDETR_ENABLED: '1',
      RFDETR_BASE_URL: 'http://127.0.0.1:8080',
      RFDETR_MODELS: 'rf-detr-medium'
    });

    expect(config.visionTargets).toEqual([
      {
        provider: 'rfdetr',
        apiKey: undefined,
        baseUrl: 'http://127.0.0.1:8080',
        models: ['rf-detr-medium']
      }
    ]);
  });

  it('skips vendors without key or models', () => {
    const config = loadProviderMatrixEnv({
      LLM_VENDOR_ORDER: 'gemini,openai',
      GEMINI_API_KEY: 'gm-key',
      GEMINI_MODELS: '',
      OPENAI_API_KEY: 'oa-key',
      OPENAI_MODELS: 'gpt-5-mini'
    });

    expect(config.llmTargets).toHaveLength(1);
    expect(config.llmTargets[0]?.provider).toBe('openai');
  });
});
