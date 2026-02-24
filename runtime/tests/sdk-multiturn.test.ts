import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createMultiTurnAutomationSdk } from '../src/sdk/multiturn-sdk';
import type { RunWithImprovementOutput, WebAutomationSdk } from '../src/sdk/automation-sdk';
import type { WorkflowDefinition } from '../src/workflow/types';

const WORKFLOW: WorkflowDefinition = {
  workflowId: 'sdk-multiturn-workflow',
  nodes: [
    {
      id: 'n1',
      type: 'NavigateNode',
      op: 'goto'
    }
  ]
};

function automationOutput(status: 'pass' | 'fail'): RunWithImprovementOutput {
  return {
    flow: {
      finalStatus: status,
      deterministic: {
        status,
        steps: [],
        failures: status === 'fail' ? [{ code: 'Unknown', message: 'failed' }] : []
      }
    },
    improvement:
      status === 'fail'
        ? {
            triggered: true,
            reason: 'test triggered'
          }
        : {
            triggered: false,
            reason: 'pass'
          }
  };
}

describe('MultiTurnAutomationSdk', () => {
  it('runs session lifecycle and stores assistant turns', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'sdk-multiturn-'));

    try {
      const sdk = createMultiTurnAutomationSdk({
        sessionRootDir: root,
        engine: {
          async generate(input) {
            return {
              content: `next:${input.userMessage}`
            };
          }
        }
      });

      const session = await sdk.createSession({
        title: 'sdk session'
      });

      const turn = await sdk.sendUserTurn({
        sessionId: session.id,
        content: 'run next action'
      });

      expect(turn.session.turns.length).toBe(2);
      expect(turn.assistantTurn.content).toBe('next:run next action');

      const listed = await sdk.listSessions();
      expect(listed.length).toBe(1);

      const closed = await sdk.closeSession(session.id);
      expect(closed.status).toBe('closed');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('adds automation summary metadata when automation run is attached', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'sdk-multiturn-auto-'));

    try {
      const fakeWebAutomationSdk: WebAutomationSdk = {
        run: async () => {
          throw new Error('not used');
        },
        runWithImprovement: async () => automationOutput('fail')
      } as unknown as WebAutomationSdk;

      const sdk = createMultiTurnAutomationSdk({
        sessionRootDir: root,
        webAutomationSdk: fakeWebAutomationSdk,
        engine: {
          async generate() {
            return {
              content: 'assistant after automation'
            };
          }
        }
      });

      const session = await sdk.createSession({
        title: 'automation session'
      });

      const output = await sdk.sendUserTurn({
        sessionId: session.id,
        content: 'execute workflow with automation',
        automation: {
          workflow: WORKFLOW,
          adapter: {
            execute: async () => ({ ok: true })
          }
        }
      });

      expect(output.automation?.flow.finalStatus).toBe('fail');
      expect(output.session.turns[0]?.metadata?.automation).toBeTruthy();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
