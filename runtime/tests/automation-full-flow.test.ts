import { describe, expect, it } from 'vitest';

import { runAutomationFullFlow } from '../src/testing/automation-full-flow';
import type { WorkflowDefinition } from '../src/workflow/types';

const simpleWorkflow: WorkflowDefinition = {
  workflowId: 'wf_full_flow',
  nodes: [
    { id: 'n1', type: 'NavigateNode', op: 'goto', next: 'n2' },
    { id: 'n2', type: 'ActionNode', op: 'click' }
  ]
};

describe('runAutomationFullFlow', () => {
  it('passes across deterministic + recovery + human revise flow', async () => {
    let selectorPatched = false;
    let visualPatched = false;
    let revised = false;

    const result = await runAutomationFullFlow({
      workflow: simpleWorkflow,
      adapter: {
        execute: async () => ({ ok: true })
      },
      selectorRecovery: {
        recipe: {
          workflowId: 'wf_full_flow',
          version: 'v001',
          selectors: { target: { css: '#old', updatedAt: '2026-02-24T00:00:00Z' } }
        },
        run: async () => {
          if (!selectorPatched) {
            selectorPatched = true;
            return {
              status: 'fail',
              failureCode: 'SelectorNotFound',
              proposedPatch: {
                target: 'selectors',
                reason: 'selector drift',
                operations: [{ op: 'replace', path: '/selectors/target', value: { css: '#new' } }]
              }
            };
          }
          return { status: 'pass' };
        }
      },
      visualRecovery: {
        recipe: {
          workflowId: 'wf_full_flow',
          version: 'v001',
          selectors: { target: { css: '#oldv', updatedAt: '2026-02-24T00:00:00Z' } }
        },
        run: async () => {
          if (!visualPatched) {
            visualPatched = true;
            return {
              status: 'fail',
              failureCode: 'VisualAmbiguity',
              rois: [{ id: 'r1', bbox: [0, 0, 10, 10] }],
              patchesByRoiId: {
                r1: {
                  target: 'selectors',
                  reason: 'vision choose',
                  operations: [{ op: 'replace', path: '/selectors/target', value: { css: '#vision' } }]
                }
              }
            };
          }
          return { status: 'pass' };
        },
        selectRoi: async () => 'r1'
      },
      humanLoop: {
        workflowId: 'wf_full_flow',
        run: async () => (revised ? { status: 'pass' } : { status: 'need_user', question: '진행?' }),
        decisionPort: {
          requestDecision: async () => 'revise'
        },
        reviseWithLlm: async () => {
          revised = true;
        }
      }
    });

    expect(result.finalStatus).toBe('pass');
    expect(result.deterministic.status).toBe('pass');
    expect(result.selectorRecovery?.status).toBe('pass');
    expect(result.visualRecovery?.status).toBe('pass');
    expect(result.humanLoop?.status).toBe('pass');
    expect(result.humanLoop?.revisions).toBe(1);
  });

  it('blocks when human decision is not_go', async () => {
    const result = await runAutomationFullFlow({
      workflow: simpleWorkflow,
      adapter: {
        execute: async () => ({ ok: true })
      },
      humanLoop: {
        workflowId: 'wf_block',
        run: async () => ({ status: 'need_user', question: '중단?' }),
        decisionPort: {
          requestDecision: async () => 'not_go'
        }
      }
    });

    expect(result.finalStatus).toBe('blocked');
    expect(result.humanLoop?.decisions).toEqual(['not_go']);
  });

  it('fails when selector recovery cannot recover', async () => {
    const result = await runAutomationFullFlow({
      workflow: simpleWorkflow,
      adapter: {
        execute: async () => ({ ok: true })
      },
      selectorRecovery: {
        recipe: {
          workflowId: 'wf_fail',
          version: 'v001',
          selectors: { target: { css: '#missing', updatedAt: '2026-02-24T00:00:00Z' } }
        },
        run: async () => ({
          status: 'fail',
          failureCode: 'SelectorNotFound'
        })
      }
    });

    expect(result.finalStatus).toBe('fail');
    expect(result.selectorRecovery?.status).toBe('fail');
    expect(result.humanLoop).toBeUndefined();
  });
});
