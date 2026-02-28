import type { Orchestrator, OrchestratorRunResult, OrchestratorRuntime } from '../v3/orchestrator';

export type V3BrowserMode = 'headful' | 'headless';

export interface CreateRuntimeInput {
  targetUrl?: string;
  browserMode: V3BrowserMode;
}

export interface V3RuntimeFactory {
  create(input: CreateRuntimeInput): Promise<OrchestratorRuntime>;
}

export interface RunV3TaskInput {
  task: string;
  targetUrl?: string;
  browserMode?: V3BrowserMode;
}

export interface RunV3TaskOutput extends OrchestratorRunResult {
  browserMode: V3BrowserMode;
}

export interface V3OrchestratorServiceOptions {
  orchestrator: Orchestrator;
  runtimeFactory: V3RuntimeFactory;
}

export class V3OrchestratorService {
  private readonly orchestrator: Orchestrator;
  private readonly runtimeFactory: V3RuntimeFactory;

  constructor(options: V3OrchestratorServiceOptions) {
    this.orchestrator = options.orchestrator;
    this.runtimeFactory = options.runtimeFactory;
  }

  async runTask(input: RunV3TaskInput): Promise<RunV3TaskOutput> {
    const task = input.task.trim();
    if (!task) {
      throw new Error('task must not be empty');
    }

    const browserMode = input.browserMode ?? 'headless';
    const runtime = await this.runtimeFactory.create({
      targetUrl: input.targetUrl,
      browserMode
    });
    const result = await this.orchestrator.run(task, runtime);
    return {
      ...result,
      browserMode
    };
  }
}
