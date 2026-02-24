import type { RunArtifact } from '../types';

export class ReplayStore {
  private readonly runs: RunArtifact[] = [];

  add(run: RunArtifact): void {
    this.runs.push(run);
  }

  getByWorkflow(workflowId: string): RunArtifact[] {
    return this.runs.filter((run) => run.workflowId === workflowId);
  }

  getFailedRuns(workflowId: string): RunArtifact[] {
    return this.runs.filter((run) => run.workflowId === workflowId && run.status === 'fail');
  }
}
