import { resolve } from 'node:path';

import {
  AutoImprovementOrchestrator,
  EvolutionService,
  createWebAutomationSdk,
  type DeterministicAdapter,
  type WorkflowDefinition
} from '../src/index';

const workflow: WorkflowDefinition = {
  workflowId: 'sample-failing-workflow',
  nodes: [{ id: 'n1', type: 'ActionNode', op: 'click' }]
};

const failingAdapter: DeterministicAdapter = {
  async execute() {
    return {
      ok: false,
      failureCode: 'SelectorNotFound',
      message: 'selector drift'
    };
  }
};

async function main(): Promise<void> {
  const repoRoot = resolve(process.cwd(), '..');

  const evolutionService = new EvolutionService({
    repoRoot,
    stateRoot: resolve(repoRoot, 'testing/evolution/state-sdk-example'),
    baseBranch: 'main',
    defaultTestCommand: 'cd runtime && npm run test:evolution',
    maxAutoFixAttempts: 1
  });

  const orchestrator = AutoImprovementOrchestrator.fromEvolutionService(evolutionService, {
    triggerStatuses: ['fail'],
    autoApprove: false
  });

  const sdk = createWebAutomationSdk({
    autoImprovement: orchestrator
  });

  const output = await sdk.runWithImprovement({
    workflow,
    adapter: failingAdapter,
    improvement: {
      requestedBy: 'sdk-example',
      notes: 'Example run for automatic evolution trigger'
    }
  });

  console.log({
    finalStatus: output.flow.finalStatus,
    improvementTriggered: output.improvement?.triggered,
    improvementState: output.improvement?.completed?.job.status
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
