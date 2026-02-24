import { describe, expect, it } from 'vitest';

import { evaluateCanaryGate, promoteRuleVersion } from '../src/learning/rule-promotion';

describe('rule promotion', () => {
  it('opens gate when success rate and regression constraints are satisfied', () => {
    const gate = evaluateCanaryGate({
      baselineSuccessRate: 0.8,
      candidateSuccessRate: 0.9,
      regressionCount: 0,
      minImprovement: 0.05
    });

    expect(gate.pass).toBe(true);
  });

  it('blocks gate when regressions are present', () => {
    const gate = evaluateCanaryGate({
      baselineSuccessRate: 0.8,
      candidateSuccessRate: 0.95,
      regressionCount: 1,
      minImprovement: 0.05
    });

    expect(gate.pass).toBe(false);
  });

  it('promotes version number when gate passes', () => {
    expect(promoteRuleVersion('rule-001')).toBe('rule-002');
    expect(promoteRuleVersion('rule-099')).toBe('rule-100');
  });
});
