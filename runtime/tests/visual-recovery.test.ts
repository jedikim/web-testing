import { describe, expect, it } from 'vitest';

import { executeWithVisualRecovery } from '../src/vision/visual-recovery';
import type { SelectorRecipe } from '../src/fallback/recipe-version';

describe('executeWithVisualRecovery', () => {
  it('recovers visual ambiguity by ROI selection and selector patch', async () => {
    const initial: SelectorRecipe = {
      workflowId: 'shopping_search_v01',
      version: 'v001',
      selectors: {
        checkout_button: { css: '#old-checkout', updatedAt: '2026-02-24T00:00:00Z' }
      }
    };

    let attempts = 0;
    const result = await executeWithVisualRecovery({
      recipe: initial,
      run: async (recipe) => {
        attempts += 1;
        if (recipe.selectors.checkout_button?.css === '#old-checkout') {
          return {
            status: 'fail',
            failureCode: 'VisualAmbiguity',
            rois: [
              { id: 'r1', bbox: [0, 0, 10, 10] },
              { id: 'r2', bbox: [10, 0, 20, 10] }
            ],
            patchesByRoiId: {
              r1: {
                target: 'selectors',
                reason: 'wrong button',
                operations: [
                  {
                    op: 'replace',
                    path: '/selectors/checkout_button',
                    value: { css: '#new-checkout' }
                  }
                ]
              }
            }
          };
        }
        return { status: 'pass' };
      },
      selectRoi: async (batches) => batches[0].members[0].id
    });

    expect(result.status).toBe('pass');
    expect(result.recipe.version).toBe('v002');
    expect(result.recipe.selectors.checkout_button?.css).toBe('#new-checkout');
    expect(result.visionCalls).toBe(1);
    expect(attempts).toBe(2);
  });
});
