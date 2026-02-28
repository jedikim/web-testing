import { describe, expect, it } from 'vitest';

import { CanvasDetector } from '../src/v3/canvas-detector';
import { CanvasExecutor } from '../src/v3/canvas-executor';
import { Orchestrator, type OrchestratorRuntime } from '../src/v3/orchestrator';
import { Planner } from '../src/v3/planner';

describe('Week9 canvas-only path', () => {
  it('detects canvas-heavy pages from DOM signals', () => {
    const detector = new CanvasDetector({
      minCanvasNodes: 1,
      maxInteractiveRatio: 0.3
    });
    const signal = detector.analyze([
      { nodeId: 1, tag: 'canvas', text: '', attrs: {} },
      { nodeId: 2, tag: 'div', text: '', attrs: {} },
      { nodeId: 3, tag: 'div', text: '', attrs: {} },
      { nodeId: 4, tag: 'button', text: '', attrs: {} }
    ]);
    expect(detector.isCanvasHeavy(signal)).toBe(true);
  });

  it('uses local detector first and falls back to VLM when detector returns empty', async () => {
    const runtime = {
      async getViewportSize() {
        return { width: 1000, height: 500 };
      },
      async mouseClick(_x: number, _y: number) {
        return;
      }
    };

    const detectorFirst = new CanvasExecutor({
      detector: {
        async detect() {
          return [{ box: [100, 50, 300, 200], confidence: 0.9 }];
        }
      },
      vlm: {
        async generate() {
          return '{"x":0.1,"y":0.1}';
        }
      }
    });
    const first = await detectorFirst.execute(runtime, Buffer.from('fake'), 'canvas click');
    expect(first.usedDetector).toBe(true);
    expect(first.usedVlmFallback).toBe(false);

    const detectorFallback = new CanvasExecutor({
      detector: {
        async detect() {
          return [];
        }
      },
      vlm: {
        async generate() {
          return '{"x":0.6,"y":0.4}';
        }
      }
    });
    const second = await detectorFallback.execute(runtime, Buffer.from('fake'), 'canvas click');
    expect(second.usedDetector).toBe(false);
    expect(second.usedVlmFallback).toBe(true);
  });

  it('routes orchestrator step through canvas path when canvas-heavy signal is detected', async () => {
    class CanvasRuntime implements OrchestratorRuntime {
      public clickSelectorCalls = 0;
      private url = 'https://canvas.example.com';

      async getUrl(): Promise<string> {
        return this.url;
      }
      async getDomain(): Promise<string> {
        return 'canvas.example.com';
      }
      async getPlannerImage(): Promise<{ mimeType: string; bytesBase64: string }> {
        return { mimeType: 'image/png', bytesBase64: Buffer.from('fake').toString('base64') };
      }
      async getVisualHash(): Promise<string> {
        return this.url.includes('/done') ? 'bbbb' : 'aaaa';
      }
      async domExists(): Promise<boolean> {
        return false;
      }
      async wait(): Promise<void> {
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
                          backendNodeId: 300,
                          nodeName: 'CANVAS',
                          attributes: [],
                          children: []
                        },
                        {
                          nodeId: 4,
                          backendNodeId: 400,
                          nodeName: 'DIV',
                          attributes: [],
                          children: []
                        }
                      ]
                    }
                  ]
                }
              };
            }
            if (method === 'Accessibility.getFullAXTree') {
              return { nodes: [] };
            }
            throw new Error(`unsupported method ${method}`);
          }
        };
      }
      async clickSelector(): Promise<void> {
        this.clickSelectorCalls += 1;
      }
      async fillSelector(): Promise<void> {
        return;
      }
      async mouseClick(): Promise<void> {
        this.url = 'https://canvas.example.com/done';
      }
      async typeText(): Promise<void> {
        return;
      }
      async getViewportSize(): Promise<{ width: number; height: number }> {
        return { width: 1000, height: 700 };
      }
    }

    const planner = new Planner({
      model: {
        async generate(): Promise<string> {
          return JSON.stringify({
            screen_state: { has_obstacle: false },
            steps: [
              {
                action_type: 'click',
                target_description: 'canvas play button',
                keyword_weights: { play: 1.0 },
                target_viewport_xy: [0.5, 0.5],
                expected_result: 'URL 변경: /done'
              }
            ]
          });
        }
      }
    });

    const runtime = new CanvasRuntime();
    const orchestrator = new Orchestrator({
      planner,
      canvasMode: 'auto',
      canvasDetector: new CanvasDetector({
        minCanvasNodes: 1,
        maxInteractiveRatio: 0.2
      }),
      canvasExecutor: new CanvasExecutor({
        detector: {
          async detect() {
            return [{ box: [400, 200, 600, 400], confidence: 0.9 }];
          }
        },
        vlm: {
          async generate() {
            return '{"x":0.5,"y":0.5}';
          }
        }
      })
    });

    const result = await orchestrator.run('canvas 버튼 클릭', runtime);
    expect(result.ok).toBe(true);
    expect(runtime.clickSelectorCalls).toBe(0);
  });
});
