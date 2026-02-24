import { describe, expect, it } from 'vitest';

import {
  classifyFailureCode,
  healingCategoryFor,
  suggestedHealingAction
} from '../src/policies/self-healing-taxonomy';

describe('self-healing taxonomy', () => {
  it('classifies timing timeout from error message', () => {
    const code = classifyFailureCode({
      failureCode: 'Unknown',
      message: 'Timeout 30000ms exceeded while waiting for selector'
    });
    expect(code).toBe('TimingTimeout');
    expect(healingCategoryFor(code)).toBe('timing');
  });

  it('classifies hidden element as interaction issue', () => {
    const code = classifyFailureCode({
      failureCode: 'ActionNotApplied',
      message: 'Element is not visible and cannot be clicked'
    });
    expect(code).toBe('HiddenElement');
    expect(healingCategoryFor(code)).toBe('interaction');
    expect(suggestedHealingAction(code)).toContain('menu');
  });

  it('classifies data mismatch and render issues', () => {
    expect(
      classifyFailureCode({
        failureCode: 'ExpectationFailed',
        message: 'Expected date 2026-02-24 but got 2026-02-25'
      })
    ).toBe('DataMismatch');

    expect(
      classifyFailureCode({
        failureCode: 'Unknown',
        message: 'hydration not finished; blank skeleton rendered'
      })
    ).toBe('RenderBlocked');
  });
});
