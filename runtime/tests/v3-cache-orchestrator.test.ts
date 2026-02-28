import { describe, expect, it } from 'vitest';

import { ActionCache, PlanCache } from '../src/v3/cache';
import { Orchestrator, type OrchestratorRuntime } from '../src/v3/orchestrator';
import { Planner } from '../src/v3/planner';
import { createV3OrchestrationSdk } from '../src/sdk/v3-orchestration-sdk';

class FakeRuntime implements OrchestratorRuntime {
  private url: string;
  private clickFailuresRemaining: number;
  private mouseFailuresRemaining: number;

  constructor(initialUrl: string, clickFailures = 0, mouseFailures = 0) {
    this.url = initialUrl;
    this.clickFailuresRemaining = clickFailures;
    this.mouseFailuresRemaining = mouseFailures;
  }

  async getUrl(): Promise<string> {
    return this.url;
  }

  async getDomain(): Promise<string> {
    return 'shopping.naver.com';
  }

  async getPlannerImage(): Promise<{ mimeType: string; bytesBase64: string }> {
    return {
      mimeType: 'image/png',
      bytesBase64: 'ZmFrZQ=='
    };
  }

  async getVisualHash(): Promise<string> {
    return this.url.includes('/search') ? 'bbbb' : 'aaaa';
  }

  async domExists(selector: string): Promise<boolean> {
    return selector === '#query';
  }

  async wait(_ms: number): Promise<void> {
    return;
  }

  getDOMClient() {
    return {
      send: async (method: string): Promise<unknown> => {
        if (method === 'DOM.getDocument') {
          return {
            root: {
              nodeId: 1,
              nodeName: 'HTML',
              children: [
                {
                  nodeId: 2,
                  nodeName: 'BODY',
                  children: [
                    {
                      nodeId: 3,
                      backendNodeId: 333,
                      nodeName: 'INPUT',
                      attributes: ['id', 'query', 'placeholder', '검색'],
                      children: []
                    }
                  ]
                }
              ]
            }
          };
        }
        if (method === 'Accessibility.getFullAXTree') {
          return {
            nodes: [
              {
                backendDOMNodeId: 333,
                role: { value: 'textbox' },
                name: { value: '검색창' }
              }
            ]
          };
        }
        throw new Error(`unsupported method: ${method}`);
      }
    };
  }

  async clickSelector(selector: string): Promise<void> {
    if (this.clickFailuresRemaining > 0) {
      this.clickFailuresRemaining -= 1;
      throw new Error('Timeout while waiting for selector');
    }
    if (selector === '#query') {
      this.url = 'https://shopping.naver.com/search?q=등산복';
      return;
    }
    throw new Error(`selector not found: ${selector}`);
  }

  async fillSelector(selector: string, value: string): Promise<void> {
    if (selector === '#query' && value.length > 0) {
      this.url = `https://shopping.naver.com/search?q=${encodeURIComponent(value)}`;
      return;
    }
    throw new Error('fill failed');
  }

  async mouseClick(_x: number, _y: number): Promise<void> {
    if (this.mouseFailuresRemaining > 0) {
      this.mouseFailuresRemaining -= 1;
      throw new Error('Timeout while waiting for selector');
    }
    this.url = 'https://shopping.naver.com/search?q=등산복';
  }

  async typeText(_value: string): Promise<void> {
    return;
  }

  async getViewportSize(): Promise<{ width: number; height: number }> {
    return { width: 1200, height: 900 };
  }
}

describe('Week5 cache + orchestrator integration', () => {
  it('reuses plan cache and action cache on second run (planner call count stays 1)', async () => {
    let plannerCalls = 0;
    const planner = new Planner({
      model: {
        async generate(): Promise<string> {
          plannerCalls += 1;
          return JSON.stringify({
            screen_state: {
              has_obstacle: false
            },
            steps: [
              {
                action_type: 'click',
                target_description: '검색창',
                keyword_weights: { 검색창: 1.0 },
                target_viewport_xy: [0.3, 0.15],
                expected_result: 'URL 변경: /search'
              }
            ]
          });
        }
      }
    });

    const orchestrator = new Orchestrator({
      planner,
      actionCache: new ActionCache(),
      planCache: new PlanCache()
    });

    const first = await orchestrator.run('등산복 찾기', new FakeRuntime('https://shopping.naver.com/'));
    const second = await orchestrator.run('등산복 찾기', new FakeRuntime('https://shopping.naver.com/'));

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(second.usedPlanCache).toBe(true);
    expect(second.traces[0]?.usedActionCache).toBe(true);
    expect(plannerCalls).toBe(1);
  });

  it('exposes orchestrator run via SDK wrapper', async () => {
    const planner = new Planner({
      model: {
        async generate(): Promise<string> {
          return JSON.stringify({
            screen_state: { has_obstacle: false },
            steps: [
              {
                action_type: 'click',
                target_description: '검색창',
                keyword_weights: { 검색창: 1.0 },
                target_viewport_xy: [0.3, 0.15],
                expected_result: 'URL 변경: /search'
              }
            ]
          });
        }
      }
    });

    const sdk = createV3OrchestrationSdk({
      orchestrator: new Orchestrator({
        planner
      })
    });

    const result = await sdk.runTask({
      task: '등산복 찾기',
      runtime: new FakeRuntime('https://shopping.naver.com/')
    });
    expect(result.ok).toBe(true);
  });

  it('recovers from transient first failure via retry policy', async () => {
    const planner = new Planner({
      model: {
        async generate(): Promise<string> {
          return JSON.stringify({
            screen_state: { has_obstacle: false },
            steps: [
              {
                action_type: 'click',
                target_description: '검색창',
                keyword_weights: { 검색창: 1.0 },
                target_viewport_xy: [0.3, 0.15],
                expected_result: 'URL 변경: /search'
              }
            ]
          });
        }
      }
    });
    const orchestrator = new Orchestrator({
      planner,
      maxStepAttempts: 3
    });
    const result = await orchestrator.run('등산복 찾기', new FakeRuntime('https://shopping.naver.com/', 1, 1));

    expect(result.ok).toBe(true);
    expect(result.traces[0]?.attempts).toBeGreaterThanOrEqual(2);
  });
});
