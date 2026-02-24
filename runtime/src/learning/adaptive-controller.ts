import { evaluateCanaryGate, promoteRuleVersion } from './rule-promotion';

export interface AdaptiveControllerOptions {
  successThreshold?: number;
  minImprovement?: number;
}

export interface AdaptiveRunInput {
  promoted: boolean;
  ruleVersion: string;
}

export interface AdaptiveRunResult {
  status: 'pass' | 'fail';
  llmCalls: number;
  regressionCount: number;
}

export interface AdaptiveReport {
  workflowId: string;
  runs: number;
  ruleVersion: string;
  llmCallsSeries: number[];
  promotedAtRun: number | null;
  averageLlmCallsBeforePromotion: number;
  averageLlmCallsAfterPromotion: number;
}

interface WorkflowAdaptiveState {
  ruleVersion: string;
  promoted: boolean;
  successStreak: number;
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((acc, value) => acc + value, 0) / values.length;
}

export class AdaptiveController {
  private readonly state = new Map<string, WorkflowAdaptiveState>();
  private readonly successThreshold: number;
  private readonly minImprovement: number;

  constructor(options: AdaptiveControllerOptions = {}) {
    this.successThreshold = Math.max(1, options.successThreshold ?? 3);
    this.minImprovement = options.minImprovement ?? 0.05;
  }

  private getState(workflowId: string): WorkflowAdaptiveState {
    const existing = this.state.get(workflowId);
    if (existing) {
      return existing;
    }
    const created: WorkflowAdaptiveState = {
      ruleVersion: 'rule-001',
      promoted: false,
      successStreak: 0
    };
    this.state.set(workflowId, created);
    return created;
  }

  async runRepeated(
    workflowId: string,
    runs: number,
    runOnce: (input: AdaptiveRunInput) => Promise<AdaptiveRunResult>
  ): Promise<AdaptiveReport> {
    const state = this.getState(workflowId);
    const llmCallsSeries: number[] = [];
    const llmBeforePromotion: number[] = [];
    const llmAfterPromotion: number[] = [];
    let promotedAtRun: number | null = null;

    for (let i = 0; i < runs; i += 1) {
      const result = await runOnce({ promoted: state.promoted, ruleVersion: state.ruleVersion });
      llmCallsSeries.push(result.llmCalls);

      if (state.promoted) {
        llmAfterPromotion.push(result.llmCalls);
      } else {
        llmBeforePromotion.push(result.llmCalls);
      }

      if (state.promoted) {
        continue;
      }

      if (result.status === 'pass') {
        state.successStreak += 1;
      } else {
        state.successStreak = 0;
      }

      if (state.successStreak >= this.successThreshold) {
        const gate = evaluateCanaryGate({
          baselineSuccessRate: 0.8,
          candidateSuccessRate: 1.0,
          regressionCount: result.regressionCount,
          minImprovement: this.minImprovement
        });
        if (gate.pass) {
          state.ruleVersion = promoteRuleVersion(state.ruleVersion);
          state.promoted = true;
          promotedAtRun = i + 1;
        }
      }
    }

    return {
      workflowId,
      runs,
      ruleVersion: state.ruleVersion,
      llmCallsSeries,
      promotedAtRun,
      averageLlmCallsBeforePromotion: average(llmBeforePromotion),
      averageLlmCallsAfterPromotion: average(llmAfterPromotion)
    };
  }
}
