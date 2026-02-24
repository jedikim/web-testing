import { describe, expect, it } from 'vitest';

import { executeWorkflow } from '../src/engine/deterministic-runner';
import { executeWithSelectorRecovery } from '../src/fallback/auto-recovery';
import { executeWithVisualRecovery } from '../src/vision/visual-recovery';
import { AdaptiveController } from '../src/learning/adaptive-controller';
import { ResilienceOrchestrator } from '../src/ops/resilience-orchestrator';
import type { WorkflowDefinition } from '../src/workflow/types';
import { runScreenshotChatLoop } from '../src/chat/screenshot-chat-loop';

describe('phase acceptance', () => {
  it('phase1: deterministic scenario runs without llm', async () => {
    const workflow: WorkflowDefinition = {
      workflowId: 'phase1_fixed',
      nodes: [
        { id: 'n1', type: 'NavigateNode', op: 'goto', next: 'n2' },
        { id: 'n2', type: 'ActionNode', op: 'click', next: 'n3' },
        { id: 'n3', type: 'VerifyNode', op: 'assert' }
      ]
    };

    const result = await executeWorkflow(workflow, {
      adapter: { execute: async () => ({ ok: true }) }
    });

    expect(result.status).toBe('pass');
    expect(result.steps).toHaveLength(3);
  });

  it('phase2: selector change is auto-recovered and rerun succeeds', async () => {
    const initial = {
      workflowId: 'phase2',
      version: 'v001',
      selectors: { target: { css: '#old', updatedAt: '2026-02-24T00:00:00Z' } }
    };

    const result = await executeWithSelectorRecovery({
      recipe: initial,
      run: async (recipe) =>
        recipe.selectors.target.css === '#old'
          ? {
              status: 'fail',
              failureCode: 'SelectorNotFound',
              candidates: [{ id: 'c1', role: 'button', text: 'Target', score: 1, bbox: [0, 0, 1, 1] }],
              proposedPatch: {
                target: 'selectors',
                reason: 'changed',
                operations: [{ op: 'replace', path: '/selectors/target', value: { css: '#new' } }]
              }
            }
          : { status: 'pass' }
    });

    expect(result.status).toBe('pass');
    expect(result.recipe.version).toBe('v002');
  });

  it('phase3: visual ambiguity is recovered and screenshot chat decision works', async () => {
    const initial = {
      workflowId: 'phase3',
      version: 'v001',
      selectors: { target: { css: '#old', updatedAt: '2026-02-24T00:00:00Z' } }
    };

    const result = await executeWithVisualRecovery({
      recipe: initial,
      run: async (recipe) =>
        recipe.selectors.target.css === '#old'
          ? {
              status: 'fail',
              failureCode: 'VisualAmbiguity',
              rois: [{ id: 'r1', bbox: [0, 0, 10, 10] }],
              patchesByRoiId: {
                r1: {
                  target: 'selectors',
                  reason: 'vision resolved',
                  operations: [{ op: 'replace', path: '/selectors/target', value: { css: '#new' } }]
                }
              }
            }
          : { status: 'pass' },
      selectRoi: async () => 'r1'
    });

    expect(result.status).toBe('pass');
    expect(result.visionCalls).toBe(1);

    let asked = false;
    const chatResult = await runScreenshotChatLoop({
      platform: 'telegram',
      channelId: '300',
      run: async () =>
        asked
          ? { status: 'pass' }
          : {
              status: 'need_user',
              screenshotPath: 'runs/phase3.png',
              question: '진행할까요?'
            },
      askUser: async () => {
        asked = true;
        return 'go';
      },
      maxTurns: 2
    });

    expect(chatResult.status).toBe('pass');
  });

  it('phase4: repeated runs lower llm call rate and auto-promote rules', async () => {
    const controller = new AdaptiveController({ successThreshold: 2 });
    const report = await controller.runRepeated('phase4', 5, async ({ promoted }) => ({
      status: 'pass',
      llmCalls: promoted ? 0 : 1,
      regressionCount: 0
    }));
    expect(report.ruleVersion).toBe('rule-002');
    expect(report.averageLlmCallsAfterPromotion).toBeLessThan(report.averageLlmCallsBeforePromotion);
  });

  it('phase5: multi-scenario runs stay stable and recover from failure', async () => {
    const orchestrator = new ResilienceOrchestrator({ maxConcurrentSessions: 2 });
    let failedOnce = false;
    const report = await orchestrator.runAll(
      [
        { scenarioId: 'a', workflowId: 'w1' },
        { scenarioId: 'b', workflowId: 'w2' }
      ],
      {
        run: async ({ scenarioId }) => {
          if (scenarioId === 'a' && !failedOnce) {
            failedOnce = true;
            return { status: 'fail', reason: 'temporary failure' };
          }
          return { status: 'pass' };
        },
        recover: async () => ({ status: 'pass' })
      }
    );

    expect(report.failedCount).toBe(0);
    expect(report.recoveredCount).toBe(1);
  });
});
