import { describe, expect, it } from 'vitest';

import { Orchestrator, type OrchestratorRuntime } from '../src/v3/orchestrator';
import { Planner } from '../src/v3/planner';
import { SkillRegistry, SkillSynthesizer, validateSkillCode } from '../src/v3/skill-synthesis';

class SkillRuntime implements OrchestratorRuntime {
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
  async fillSelector(): Promise<void> {
    throw new Error('not used');
  }
  async mouseClick(): Promise<void> {
    this.url = 'https://example.com/done';
  }
  async typeText(): Promise<void> {
    return;
  }
  async getViewportSize(): Promise<{ width: number; height: number }> {
    return { width: 1000, height: 700 };
  }
}

describe('Week7 skill synthesis', () => {
  it('synthesizes python skill code and validates whitelist', () => {
    const synth = new SkillSynthesizer();
    const skill = synth.synthesize({
      domain: 'example.com',
      task: '검색창 클릭',
      plan: [
        {
          stepIndex: 1,
          actionType: 'click',
          targetDescription: '검색창',
          keywordWeights: { 검색창: 1.0 },
          expectedResult: 'URL 변경: /done'
        }
      ]
    });

    expect(skill.code).toContain('async def run_skill(browser):');
    expect(skill.code).toContain("await browser.click_target('검색창')");
    const validation = validateSkillCode(skill.code);
    expect(validation.ok).toBe(true);
  });

  it('detects blocked patterns in synthesized code validator', () => {
    const result = validateSkillCode("import os\nasync def run_skill(browser):\n    os.system('rm -rf /')");
    expect(result.ok).toBe(false);
    expect(result.violations.length).toBeGreaterThan(0);
  });

  it('reuses synthesized skill path in orchestrator on subsequent run', async () => {
    let plannerCalls = 0;
    const planner = new Planner({
      model: {
        async generate(): Promise<string> {
          plannerCalls += 1;
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
    const registry = new SkillRegistry();
    const orchestrator = new Orchestrator({
      planner,
      skillRegistry: registry
    });

    const first = await orchestrator.run('검색창 클릭', new SkillRuntime());
    const second = await orchestrator.run('검색창 클릭', new SkillRuntime());

    expect(first.ok).toBe(true);
    expect(first.usedSkill).toBe(false);
    expect(second.ok).toBe(true);
    expect(second.usedSkill).toBe(true);
    expect(plannerCalls).toBe(1);
  });
});
