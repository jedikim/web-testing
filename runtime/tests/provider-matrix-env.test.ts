import { describe, expect, it } from 'vitest';

import { loadProviderMatrixEnv } from '../src/config/provider-matrix-env';

describe('loadProviderMatrixEnv', () => {
  it('parses multi-vendor llm + yolo26 model matrix from env', () => {
    const config = loadProviderMatrixEnv({
      LLM_VENDOR_ORDER: 'gemini,openai',
      GEMINI_API_KEY: 'gm-key',
      GEMINI_MODELS: 'gemini-3.1-pro-preview,gemini-3.0-flash',
      OPENAI_API_KEY: 'oa-key',
      OPENAI_MODELS: 'gpt-5.2-codex,gpt-5-mini',
      YOLO26_ENABLED: '1',
      YOLO26_API_KEY: 'yo-key',
      YOLO26_BASE_URL: 'https://vision.example.local',
      YOLO26_MODELS: 'yolo26l'
    });

    expect(config.llmTargets).toHaveLength(2);
    expect(config.llmTargets[0]?.provider).toBe('gemini');
    expect(config.llmTargets[1]?.provider).toBe('openai');
    expect(config.llmTargets[0]?.models).toEqual(['gemini-3.1-pro-preview', 'gemini-3.0-flash']);
    expect(config.visionTargets).toEqual([
      {
        provider: 'yolo26',
        apiKey: 'yo-key',
        baseUrl: 'https://vision.example.local',
        models: ['yolo26l']
      }
    ]);
  });

  it('throws when yolo26 is enabled but required env is missing', () => {
    expect(() =>
      loadProviderMatrixEnv({
        YOLO26_ENABLED: '1',
        YOLO26_API_KEY: 'yo-key'
      })
    ).toThrow(/YOLO26_BASE_URL is required/);
  });

  it('allows yolo26 without api key for local open-source endpoint', () => {
    const config = loadProviderMatrixEnv({
      YOLO26_ENABLED: '1',
      YOLO26_BASE_URL: 'http://127.0.0.1:8080',
      YOLO26_MODELS: 'yolo26l'
    });

    expect(config.visionTargets).toEqual([
      {
        provider: 'yolo26',
        apiKey: undefined,
        baseUrl: 'http://127.0.0.1:8080',
        models: ['yolo26l']
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
