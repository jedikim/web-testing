import { describe, expect, it } from 'vitest';

import { applySelectorPatch, nextRecipeVersion, type SelectorRecipe } from '../src/fallback/recipe-version';
import type { SelectorPatch } from '../src/fallback/patch-validator';

describe('recipe versioning', () => {
  it('bumps semantic vNNN recipe versions', () => {
    expect(nextRecipeVersion('v001')).toBe('v002');
    expect(nextRecipeVersion('v009')).toBe('v010');
    expect(nextRecipeVersion('v999')).toBe('v1000');
  });

  it('applies selector patch and bumps version', () => {
    const recipe: SelectorRecipe = {
      workflowId: 'shopping_search_v01',
      version: 'v001',
      selectors: {
        checkout_button: { css: 'button.checkout', updatedAt: '2026-02-24T00:00:00Z' }
      }
    };

    const patch: SelectorPatch = {
      target: 'selectors',
      reason: 'DOM changed',
      operations: [
        {
          op: 'replace',
          path: '/selectors/checkout_button',
          value: { css: 'button[data-test=\"checkout\"]' }
        },
        {
          op: 'add',
          path: '/selectors/filter_button',
          value: { css: 'button[data-test=\"filter\"]' }
        }
      ]
    };

    const next = applySelectorPatch(recipe, patch, '2026-02-24T10:00:00Z');
    expect(next.version).toBe('v002');
    expect(next.selectors.checkout_button?.css).toBe('button[data-test=\"checkout\"]');
    expect(next.selectors.filter_button?.css).toBe('button[data-test=\"filter\"]');
  });

  it('removes selector entries using remove operation', () => {
    const recipe: SelectorRecipe = {
      workflowId: 'shopping_search_v01',
      version: 'v001',
      selectors: {
        obsolete: { css: '.old', updatedAt: '2026-02-24T00:00:00Z' }
      }
    };

    const patch: SelectorPatch = {
      target: 'selectors',
      reason: 'cleanup',
      operations: [{ op: 'remove', path: '/selectors/obsolete' }]
    };

    const next = applySelectorPatch(recipe, patch, '2026-02-24T10:00:00Z');
    expect(next.selectors.obsolete).toBeUndefined();
  });
});
