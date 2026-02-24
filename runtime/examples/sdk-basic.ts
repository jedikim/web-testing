import { createWebAutomationSdk, type DeterministicAdapter, type WorkflowDefinition } from '../src/index';

const workflow: WorkflowDefinition = {
  workflowId: 'sample-workflow',
  nodes: [
    { id: 'n1', type: 'NavigateNode', op: 'goto', next: 'n2' },
    { id: 'n2', type: 'ActionNode', op: 'click' }
  ]
};

const adapter: DeterministicAdapter = {
  async execute(node) {
    // Replace this with real Playwright adapter.
    if (node.id === 'n2') {
      return { ok: true };
    }
    return { ok: true };
  }
};

async function main(): Promise<void> {
  const sdk = createWebAutomationSdk();

  const result = await sdk.run({
    workflow,
    adapter
  });

  console.log(result.finalStatus);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
