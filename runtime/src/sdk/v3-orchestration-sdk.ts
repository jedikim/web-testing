import { Orchestrator, type OrchestratorRunResult, type OrchestratorRuntime } from '../v3/orchestrator';

export interface RunV3SdkTaskInput {
  task: string;
  runtime: OrchestratorRuntime;
}

export interface V3OrchestrationSdkOptions {
  orchestrator: Orchestrator;
}

export class V3OrchestrationSdk {
  private readonly orchestrator: Orchestrator;

  constructor(options: V3OrchestrationSdkOptions) {
    this.orchestrator = options.orchestrator;
  }

  async runTask(input: RunV3SdkTaskInput): Promise<OrchestratorRunResult> {
    return this.orchestrator.run(input.task, input.runtime);
  }
}

export function createV3OrchestrationSdk(options: V3OrchestrationSdkOptions): V3OrchestrationSdk {
  return new V3OrchestrationSdk(options);
}
