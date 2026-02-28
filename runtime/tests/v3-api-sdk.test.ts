import { once } from 'node:events';

import { describe, expect, it } from 'vitest';

import { createV3OrchestratorHttpServer } from '../src/backend/v3-orchestrator-server';
import { V3OrchestratorService } from '../src/backend/v3-orchestrator-service';
import { Orchestrator, type OrchestratorRuntime } from '../src/v3/orchestrator';
import { Planner } from '../src/v3/planner';

class ApiFakeRuntime implements OrchestratorRuntime {
  private url = 'https://example.com';

  async getUrl(): Promise<string> {
    return this.url;
  }

  async getDomain(): Promise<string> {
    return 'example.com';
  }

  async getPlannerImage(): Promise<{ mimeType: string; bytesBase64: string }> {
    return { mimeType: 'image/png', bytesBase64: 'ZmFrZQ==' };
  }

  async getVisualHash(): Promise<string> {
    return this.url.includes('/done') ? 'bbbb' : 'aaaa';
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
                      backendNodeId: 30,
                      nodeName: 'INPUT',
                      attributes: ['id', 'query'],
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
            nodes: [{ backendDOMNodeId: 30, role: { value: 'textbox' }, name: { value: '검색창' } }]
          };
        }
        throw new Error(`unsupported method: ${method}`);
      }
    };
  }

  async clickSelector(selector: string): Promise<void> {
    if (selector === '#query') {
      this.url = 'https://example.com/done';
      return;
    }
    throw new Error('selector missing');
  }

  async fillSelector(selector: string, value: string): Promise<void> {
    if (selector === '#query' && value.length > 0) {
      this.url = 'https://example.com/done';
      return;
    }
    throw new Error('fill failed');
  }

  async mouseClick(_x: number, _y: number): Promise<void> {
    this.url = 'https://example.com/done';
  }

  async typeText(_value: string): Promise<void> {
    return;
  }

  async getViewportSize(): Promise<{ width: number; height: number }> {
    return { width: 1000, height: 700 };
  }
}

describe('Week5 API/SDK integration hooks', () => {
  it('runs v3 orchestrator through backend service', async () => {
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
                target_viewport_xy: [0.2, 0.2],
                expected_result: 'URL 변경: /done'
              }
            ]
          });
        }
      }
    });
    const orchestrator = new Orchestrator({ planner });
    const service = new V3OrchestratorService({
      orchestrator,
      runtimeFactory: {
        async create(): Promise<OrchestratorRuntime> {
          return new ApiFakeRuntime();
        }
      }
    });

    const result = await service.runTask({
      task: '검색창 클릭'
    });
    expect(result.ok).toBe(true);
  });

  it('exposes /v3/run HTTP route', async () => {
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
                target_viewport_xy: [0.2, 0.2],
                expected_result: 'URL 변경: /done'
              }
            ]
          });
        }
      }
    });
    const service = new V3OrchestratorService({
      orchestrator: new Orchestrator({ planner }),
      runtimeFactory: {
        async create(): Promise<OrchestratorRuntime> {
          return new ApiFakeRuntime();
        }
      }
    });
    const server = createV3OrchestratorHttpServer({ service });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');

    const address = server.address();
    if (!address || typeof address === 'string') {
      server.close();
      throw new Error('failed to bind test server');
    }

    const response = await fetch(`http://127.0.0.1:${address.port}/v3/run`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        task: '검색창 클릭',
        browserMode: 'headless'
      })
    });
    const payload = (await response.json()) as { ok: boolean; data?: { ok?: boolean } };
    server.close();

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.data?.ok).toBe(true);
  });
});
