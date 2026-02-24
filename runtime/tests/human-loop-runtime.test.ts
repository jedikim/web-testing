import { describe, expect, it } from 'vitest';

import { runHumanLoop } from '../src/integration/human-loop-runtime';

describe('runHumanLoop', () => {
  it('passes after revise then go decision', async () => {
    let runCount = 0;
    let revised = false;
    const requests: string[] = [];

    const result = await runHumanLoop({
      workflowId: 'wf1',
      run: async () => {
        runCount += 1;
        if (!revised) {
          return {
            status: 'need_user',
            question: '진행할까요?',
            screenshotPath: `runs/${runCount}.png`
          };
        }
        return { status: 'pass' };
      },
      decisionPort: {
        requestDecision: async (request) => {
          requests.push(request.workflowId);
          return runCount === 1 ? 'revise' : 'go';
        }
      },
      reviseWithLlm: async () => {
        revised = true;
      }
    });

    expect(result.status).toBe('pass');
    expect(result.revisions).toBe(1);
    expect(result.decisions).toEqual(['revise']);
    expect(requests).toEqual(['wf1']);
    expect(runCount).toBe(2);
  });

  it('blocks when decision is not_go', async () => {
    const result = await runHumanLoop({
      workflowId: 'wf2',
      run: async () => ({
        status: 'need_user',
        question: '중단할까요?',
        screenshotPath: 'runs/x.png'
      }),
      decisionPort: {
        requestDecision: async () => 'not_go'
      }
    });

    expect(result.status).toBe('blocked');
    expect(result.decisions).toEqual(['not_go']);
  });
});
