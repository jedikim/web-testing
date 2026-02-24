import { describe, expect, it } from 'vitest';

import { resolveEvolutionModelPolicy } from '../src/evolution/model-policy';

describe('resolveEvolutionModelPolicy', () => {
  it('uses default gemini pro preview for coding and flash for automation', () => {
    const policy = resolveEvolutionModelPolicy({ source: {} });

    expect(policy.codingModel).toBe('gemini-3.1-pro-preview');
    expect(policy.automationModel).toBe('gemini-3.0-flash');
  });

  it('rejects flash model for coding path', () => {
    expect(() =>
      resolveEvolutionModelPolicy({
        source: {
          EVOLUTION_CODING_MODEL: 'gemini-3.0-flash'
        }
      })
    ).toThrow(/coding model/);
  });

  it('rejects non-flash model for automation path', () => {
    expect(() =>
      resolveEvolutionModelPolicy({
        source: {
          EVOLUTION_AUTOMATION_MODEL: 'gemini-3.1-pro-preview'
        }
      })
    ).toThrow(/automation model/);
  });
});
