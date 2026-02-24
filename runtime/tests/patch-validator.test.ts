import { describe, expect, it } from 'vitest';

import { validateSelectorPatch, type SelectorPatch } from '../src/fallback/patch-validator';

describe('validateSelectorPatch', () => {
  it('accepts valid patch-only payload', () => {
    const patch: SelectorPatch = {
      target: 'selectors',
      reason: 'selector changed',
      operations: [
        {
          op: 'replace',
          path: '/selectors/checkout_button',
          value: { css: 'button[data-test="checkout"]' }
        }
      ]
    };

    const result = validateSelectorPatch(patch);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects non-selector target', () => {
    const patch = {
      target: 'workflow',
      reason: 'invalid target',
      operations: []
    } as unknown as SelectorPatch;

    const result = validateSelectorPatch(patch);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === 'INVALID_TARGET')).toBe(true);
  });

  it('rejects path outside selectors namespace', () => {
    const patch: SelectorPatch = {
      target: 'selectors',
      reason: 'bad path',
      operations: [{ op: 'replace', path: '/runtime/main.ts', value: { css: '.x' } }]
    };

    const result = validateSelectorPatch(patch);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === 'INVALID_PATH')).toBe(true);
  });

  it('rejects add/replace without css value', () => {
    const patch: SelectorPatch = {
      target: 'selectors',
      reason: 'missing value',
      operations: [{ op: 'replace', path: '/selectors/query_input', value: {} }]
    };

    const result = validateSelectorPatch(patch);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === 'INVALID_VALUE')).toBe(true);
  });
});
