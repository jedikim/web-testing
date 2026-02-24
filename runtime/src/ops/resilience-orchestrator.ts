import { RollbackLog, type RollbackEntry } from './rollback-log';
import { SessionManager } from './session-manager';

export interface ScenarioTask {
  scenarioId: string;
  workflowId: string;
}

export interface ScenarioRunResult {
  status: 'pass' | 'fail';
  reason?: string;
}

export interface ScenarioRunner {
  run(task: ScenarioTask): Promise<ScenarioRunResult>;
  recover?: (task: ScenarioTask) => Promise<ScenarioRunResult>;
}

export interface ResilienceOrchestratorOptions {
  maxConcurrentSessions: number;
}

export interface ScenarioOutcome {
  scenarioId: string;
  workflowId: string;
  status: 'pass' | 'fail';
  recovered: boolean;
  reason?: string;
  recoveryMs?: number;
}

export interface ResilienceReport {
  results: ScenarioOutcome[];
  failedCount: number;
  recoveredCount: number;
  rollbackEntries: RollbackEntry[];
}

export class ResilienceOrchestrator {
  private readonly maxConcurrentSessions: number;

  constructor(options: ResilienceOrchestratorOptions) {
    this.maxConcurrentSessions = Math.max(1, options.maxConcurrentSessions);
  }

  async runAll(tasks: ScenarioTask[], runner: ScenarioRunner): Promise<ResilienceReport> {
    const sessionManager = new SessionManager(this.maxConcurrentSessions);
    const rollbackLog = new RollbackLog();
    const results: ScenarioOutcome[] = [];
    let cursor = 0;

    const worker = async (): Promise<void> => {
      while (true) {
        const index = cursor;
        cursor += 1;
        if (index >= tasks.length) {
          return;
        }

        const task = tasks[index];
        while (!sessionManager.startSession(task.scenarioId)) {
          await new Promise((resolve) => setTimeout(resolve, 1));
        }

        try {
          const runResult = await runner.run(task);
          if (runResult.status === 'pass') {
            results.push({
              scenarioId: task.scenarioId,
              workflowId: task.workflowId,
              status: 'pass',
              recovered: false
            });
            continue;
          }

          rollbackLog.add({
            changeId: task.scenarioId,
            reason: runResult.reason ?? 'unknown failure',
            timestamp: new Date().toISOString()
          });

          if (runner.recover) {
            const startedAt = Date.now();
            const recovery = await runner.recover(task);
            const recoveryMs = Date.now() - startedAt;
            if (recovery.status === 'pass') {
              results.push({
                scenarioId: task.scenarioId,
                workflowId: task.workflowId,
                status: 'pass',
                recovered: true,
                recoveryMs
              });
              continue;
            }

            results.push({
              scenarioId: task.scenarioId,
              workflowId: task.workflowId,
              status: 'fail',
              recovered: false,
              reason: recovery.reason ?? runResult.reason
            });
            continue;
          }

          results.push({
            scenarioId: task.scenarioId,
            workflowId: task.workflowId,
            status: 'fail',
            recovered: false,
            reason: runResult.reason
          });
        } finally {
          sessionManager.endSession(task.scenarioId);
        }
      }
    };

    await Promise.all(
      Array.from({ length: this.maxConcurrentSessions }, () => worker())
    );

    const failedCount = results.filter((result) => result.status === 'fail').length;
    const recoveredCount = results.filter((result) => result.recovered).length;

    return {
      results,
      failedCount,
      recoveredCount,
      rollbackEntries: rollbackLog.all()
    };
  }
}
