import { describe, expect, it } from 'vitest';

import {
  defaultModelFor,
  listSupportedModelIds,
  resolveModelFromOptions
} from '../src/llm/model-registry';

describe('llm model registry', () => {
  it('provides multiple gemini models', () => {
    const models = listSupportedModelIds('gemini');
    expect(models.length).toBeGreaterThanOrEqual(3);
    expect(models).toContain('gemini-3.0-flash');
  });

  it('returns provider default model when request is empty', () => {
    expect(defaultModelFor('gemini')).toBe('gemini-3.0-flash');
    expect(defaultModelFor('openai')).toBe('gpt-4.1-mini');
  });

  it('resolves requested model from options', () => {
    const model = resolveModelFromOptions({
      provider: 'gemini',
      requestedModel: 'gemini-1.5-pro',
      modelOptions: ['gemini-2.0-flash', 'gemini-1.5-pro']
    });

    expect(model).toBe('gemini-1.5-pro');
  });

  it('throws when requested model is outside explicit options', () => {
    expect(() =>
      resolveModelFromOptions({
        provider: 'gemini',
        requestedModel: 'gemini-1.5-pro',
        modelOptions: ['gemini-2.0-flash']
      })
    ).toThrow(/not in allowed model options/);
  });
});
