import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { createMultiTurnAutomationSdk } from '../src/index';

async function main(): Promise<void> {
  const sessionRoot = await mkdtemp(resolve(tmpdir(), 'sdk-multiturn-example-'));

  try {
    const sdk = createMultiTurnAutomationSdk({
      sessionRootDir: sessionRoot
    });

    const session = await sdk.createSession({
      mode: 'sdk_detailed',
      title: 'example session',
      workflowId: 'wf-example-1',
      systemPrompt: 'Be concise and propose deterministic-first automation steps.'
    });

    const first = await sdk.sendUserTurn({
      sessionId: session.id,
      content: 'Please run step-by-step plan for naver map search workflow.'
    });

    const second = await sdk.sendUserTurn({
      sessionId: session.id,
      content: 'The run failed with selector drift, what is next?'
    });

    console.log({
      sessionId: session.id,
      turnCount: second.session.turns.length,
      firstAssistant: first.assistantTurn.content,
      secondAssistant: second.assistantTurn.content
    });

    await sdk.closeSession(session.id);
  } finally {
    await rm(sessionRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
