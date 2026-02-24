import { describe, expect, it } from 'vitest';

import {
  defaultModelFor,
  listSupportedModelIds,
  resolveModelFromOptions
} from '../src/llm/model-registry';

describe('llm model registry', () => {
  it('provides multiple gemini models', () => {
    const models = listSupportedModelIds('gemini');
    expect(models.length).toBe(2);
    expect(models).toContain('gemini-3.1-pro-preview');
    expect(models).toContain('gemini-3.0-flash');
  });

  it('returns provider default model when request is empty', () => {
    expect(defaultModelFor('gemini')).toBe('gemini-3.0-flash');
    expect(defaultModelFor('openai')).toBe('gpt-5-mini');
  });

  it('resolves requested model from options', () => {
    const model = resolveModelFromOptions({
      provider: 'gemini',
      requestedModel: 'gemini-3.1-pro-preview',
      modelOptions: ['gemini-3.1-pro-preview', 'gemini-3.0-flash']
    });

    expect(model).toBe('gemini-3.1-pro-preview');
  });

  it('throws when requested model is outside explicit options', () => {
    expect(() =>
      resolveModelFromOptions({
        provider: 'gemini',
        requestedModel: 'gemini-3.1-pro-preview',
        modelOptions: ['gemini-3.0-flash']
      })
    ).toThrow(/not in allowed model options/);
  });
});
