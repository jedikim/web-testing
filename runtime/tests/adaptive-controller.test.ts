import { describe, expect, it } from 'vitest';

import { AdaptiveController } from '../src/learning/adaptive-controller';

describe('AdaptiveController', () => {
  it('reduces llm call rate on repeated runs after rule promotion', async () => {
    const controller = new AdaptiveController({ successThreshold: 2 });

    const report = await controller.runRepeated('shopping_search_v01', 5, async ({ promoted }) => {
      if (promoted) {
        return { status: 'pass', llmCalls: 0, regressionCount: 0 };
      }
      return { status: 'pass', llmCalls: 1, regressionCount: 0 };
    });

    expect(report.ruleVersion).toBe('rule-002');
    expect(report.llmCallsSeries).toEqual([1, 1, 0, 0, 0]);
    expect(report.averageLlmCallsAfterPromotion).toBeLessThan(report.averageLlmCallsBeforePromotion);
  });

  it('does not promote rules when regressions are observed', async () => {
    const controller = new AdaptiveController({ successThreshold: 2 });

    const report = await controller.runRepeated('shopping_search_v01', 3, async () => ({
      status: 'pass',
      llmCalls: 1,
      regressionCount: 1
    }));

    expect(report.ruleVersion).toBe('rule-001');
  });
});
