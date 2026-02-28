import { describe, expect, it } from 'vitest';

import { Orchestrator, type OrchestratorRuntime } from '../src/v3/orchestrator';
import { Planner } from '../src/v3/planner';

class TraversalRuntime implements OrchestratorRuntime {
  private url = 'https://shop.example.com/home';

  async getUrl(): Promise<string> {
    return this.url;
  }

  async getDomain(): Promise<string> {
    return 'shop.example.com';
  }

  async getPlannerImage(): Promise<{ mimeType: string; bytesBase64: string }> {
    return { mimeType: 'image/png', bytesBase64: 'ZmFrZQ==' };
  }

  async getVisualHash(): Promise<string> {
    if (this.url.includes('/done')) {
      return 'cccc';
    }
    if (this.url.includes('/wrong')) {
      return 'bbbb';
    }
    return 'aaaa';
  }

  async domExists(_selector: string): Promise<boolean> {
    return false;
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
                      backendNodeId: 31,
                      nodeName: 'BUTTON',
                      attributes: ['id', 'wrong'],
                      children: [{ nodeId: 30, nodeName: '#text', nodeValue: '메뉴 진입' }]
                    },
                    {
                      nodeId: 4,
                      backendNodeId: 41,
                      nodeName: 'BUTTON',
                      attributes: ['id', 'right'],
                      children: [{ nodeId: 40, nodeName: '#text', nodeValue: '메뉴 진입' }]
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
              { backendDOMNodeId: 31, role: { value: 'button' }, name: { value: '메뉴 진입' } },
              { backendDOMNodeId: 41, role: { value: 'button' }, name: { value: '메뉴 진입' } }
            ]
          };
        }
        throw new Error(`unsupported method: ${method}`);
      }
    };
  }

  async clickSelector(selector: string): Promise<void> {
    if (selector === '#wrong') {
      this.url = 'https://shop.example.com/wrong';
      return;
    }
    if (selector === '#right') {
      this.url = 'https://shop.example.com/done';
      return;
    }
    throw new Error(`unknown selector: ${selector}`);
  }

  async fillSelector(): Promise<void> {
    throw new Error('not used');
  }

  async mouseClick(_x: number, _y: number): Promise<void> {
    this.url = 'https://shop.example.com/done';
  }

  async typeText(): Promise<void> {
    return;
  }

  async getViewportSize(): Promise<{ width: number; height: number }> {
    return { width: 1200, height: 900 };
  }

  async goBack(): Promise<void> {
    this.url = 'https://shop.example.com/home';
  }
}

describe('Tree traversal on unresolved step', () => {
  it('tries alternative branches until success for click step', async () => {
    const planner = new Planner({
      expansionEnabled: false,
      model: {
        async generate(): Promise<string> {
          return JSON.stringify({
            screen_state: { has_obstacle: false },
            steps: [
              {
                action_type: 'click',
                target_description: '메뉴 진입',
                keyword_weights: { 메뉴: 1.0, 진입: 0.8 },
                target_viewport_xy: [0.2, 0.2],
                expected_result: 'URL 변경: /done'
              }
            ]
          });
        }
      }
    });

    const orchestrator = new Orchestrator({
      planner,
      maxStepAttempts: 1,
      traversalEnabled: true,
      traversalBranchWidth: 2,
      traversalMaxDepth: 3
    });

    const result = await orchestrator.run('메뉴 열고 목표 페이지로 이동', new TraversalRuntime());
    expect(result.ok).toBe(true);
    expect(result.traces[0]?.traversalUsed).toBe(true);
    expect((result.traces[0]?.traversalAttempts ?? 0) >= 1).toBe(true);
  });
});
