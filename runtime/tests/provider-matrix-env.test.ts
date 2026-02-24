import { describe, expect, it } from 'vitest';

import { loadProviderMatrixEnv } from '../src/config/provider-matrix-env';

describe('loadProviderMatrixEnv', () => {
  it('parses multi-vendor llm + yolo26 model matrix from env', () => {
    const config = loadProviderMatrixEnv({
      LLM_VENDOR_ORDER: 'gemini,openai,anthropic',
      GEMINI_API_KEY: 'gm-key',
      GEMINI_MODELS: 'gemini-2.0-flash,gemini-1.5-pro',
      OPENAI_API_KEY: 'oa-key',
      OPENAI_MODELS: 'gpt-4.1-mini,gpt-4o-mini',
      ANTHROPIC_API_KEY: 'an-key',
      ANTHROPIC_MODELS: 'claude-3-5-sonnet-latest,claude-3-5-haiku-latest',
      YOLO26_ENABLED: '1',
      YOLO26_API_KEY: 'yo-key',
      YOLO26_BASE_URL: 'https://vision.example.local',
      YOLO26_MODELS: 'yolo26n,yolo26s'
    });

    expect(config.llmTargets).toHaveLength(3);
    expect(config.llmTargets[0]?.provider).toBe('gemini');
    expect(config.llmTargets[1]?.provider).toBe('openai');
    expect(config.llmTargets[2]?.provider).toBe('anthropic');
    expect(config.llmTargets[0]?.models).toEqual(['gemini-2.0-flash', 'gemini-1.5-pro']);
    expect(config.visionTargets).toEqual([
      {
        provider: 'yolo26',
        apiKey: 'yo-key',
        baseUrl: 'https://vision.example.local',
        models: ['yolo26n', 'yolo26s']
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

  it('skips vendors without key or models', () => {
    const config = loadProviderMatrixEnv({
      LLM_VENDOR_ORDER: 'gemini,openai',
      GEMINI_API_KEY: 'gm-key',
      GEMINI_MODELS: '',
      OPENAI_API_KEY: 'oa-key',
      OPENAI_MODELS: 'gpt-4.1-mini'
    });

    expect(config.llmTargets).toHaveLength(1);
    expect(config.llmTargets[0]?.provider).toBe('openai');
  });
});
