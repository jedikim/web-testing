export interface CanaryGateInput {
  baselineSuccessRate: number;
  candidateSuccessRate: number;
  regressionCount: number;
  minImprovement: number;
}

export interface CanaryGateResult {
  pass: boolean;
  reason: string;
}

export function evaluateCanaryGate(input: CanaryGateInput): CanaryGateResult {
  if (input.regressionCount > 0) {
    return { pass: false, reason: 'regression detected' };
  }

  const delta = input.candidateSuccessRate - input.baselineSuccessRate;
  if (delta < input.minImprovement) {
    return { pass: false, reason: 'improvement below threshold' };
  }

  return { pass: true, reason: 'canary gate passed' };
}

export function promoteRuleVersion(version: string): string {
  const match = /^rule-(\d+)$/.exec(version);
  if (!match) {
    throw new Error(`invalid rule version: ${version}`);
  }
  const next = Number(match[1]) + 1;
  return `rule-${String(next).padStart(3, '0')}`;
}
