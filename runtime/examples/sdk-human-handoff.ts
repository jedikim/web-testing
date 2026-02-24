import { runHumanLoop, type HumanDecision } from '../src/index';

async function simulateBlockedByHuman(): Promise<void> {
  const result = await runHumanLoop({
    workflowId: 'wf-human-handoff-blocked',
    run: async () => ({
      status: 'need_user',
      question: 'Security challenge detected. Continue?',
      screenshotPath: 'testing/backend/state/handoff-blocked.png'
    }),
    decisionPort: {
      requestDecision: async () => 'not_go'
    }
  });

  console.log('[blocked-case]', result);
}

async function simulateReviseThenGo(): Promise<void> {
  let revised = false;
  let decisionIndex = 0;
  const decisions: HumanDecision[] = ['revise', 'go'];

  const result = await runHumanLoop({
    workflowId: 'wf-human-handoff-revise-go',
    run: async () => {
      if (!revised) {
        return {
          status: 'need_user',
          question: 'Need adjustment before safe continuation.',
          screenshotPath: 'testing/backend/state/handoff-revise.png'
        };
      }
      return { status: 'pass' };
    },
    decisionPort: {
      requestDecision: async () => {
        const picked = decisions[Math.min(decisionIndex, decisions.length - 1)] ?? 'unknown';
        decisionIndex += 1;
        return picked;
      }
    },
    reviseWithLlm: async () => {
      revised = true;
    }
  });

  console.log('[revise-go-case]', result);
}

async function main(): Promise<void> {
  await simulateBlockedByHuman();
  await simulateReviseThenGo();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
