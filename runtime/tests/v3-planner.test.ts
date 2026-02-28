import { describe, expect, it } from 'vitest';

import { Planner, buildPlannerExpansionPrompt, buildPlannerPrompt } from '../src/v3/planner';

const fakeScreenshot = {
  mimeType: 'image/png',
  bytesBase64: 'ZmFrZQ=='
};

describe('Week4 Planner', () => {
  it('builds screenshot-first planner prompt with required schema fields', () => {
    const prompt = buildPlannerPrompt('등산복 찾아줘');
    expect(prompt).toContain('screen_state');
    expect(prompt).toContain('keyword_weights');
    expect(prompt).toContain('target_viewport_xy');
  });

  it('builds expansion prompt for complex multi-step decomposition', () => {
    const prompt = buildPlannerExpansionPrompt(
      'danawa.com 에 가서 여성스포츠의류에서 등산복 찾고 10만원 이하 붉은색으로 필터',
      [
        {
          stepIndex: 1,
          actionType: 'click',
          targetDescription: '검색창',
          keywordWeights: { 검색창: 1.0 }
        }
      ],
      3
    );

    expect(prompt).toContain('multi-step');
    expect(prompt).toContain('최소 3개');
    expect(prompt).toContain('action_type은 click|type|wait');
  });

  it('parses valid planner response and keeps required step fields', async () => {
    const planner = new Planner({
      model: {
        async generate(): Promise<string> {
          return JSON.stringify({
            screen_state: {
              has_obstacle: true,
              obstacle_type: 'popup',
              obstacle_close_xy: [0.95, 0.1],
              obstacle_description: 'promo popup'
            },
            steps: [
              {
                action_type: 'click',
                target_description: '스포츠/레저 메뉴',
                keyword_weights: {
                  스포츠: 0.9,
                  레저: 0.8
                },
                target_viewport_xy: [0.2, 0.18],
                expected_result: 'URL 변경: /sports'
              },
              {
                action_type: 'type',
                target_description: '검색창',
                value: '등산복',
                keyword_weights: {
                  검색창: 1.0
                },
                target_viewport_xy: [0.35, 0.12],
                expected_result: 'DOM 존재: .search-results'
              }
            ]
          });
        }
      }
    });

    const planned = await planner.plan('등산복 찾기', fakeScreenshot);
    expect(planned.screenState.hasObstacle).toBe(true);
    expect(planned.steps).toHaveLength(2);
    expect(planned.steps[0]?.keywordWeights['스포츠']).toBeCloseTo(0.9, 4);
    expect(planned.steps[1]?.actionType).toBe('type');
  });

  it('fills missing keyword_weights with deterministic fallback tokens', async () => {
    const planner = new Planner({
      expansionEnabled: false,
      model: {
        async generate(): Promise<string> {
          return JSON.stringify({
            screen_state: {
              has_obstacle: false
            },
            steps: [
              {
                action_type: 'click',
                target_description: '카테고리 메뉴 열기'
              }
            ]
          });
        }
      }
    });

    const planned = await planner.plan('카테고리로 이동', fakeScreenshot);
    expect(planned.steps).toHaveLength(1);
    expect(Object.keys(planned.steps[0]!.keywordWeights).length).toBeGreaterThan(0);
  });

  it('throws for invalid JSON payload', async () => {
    const planner = new Planner({
      model: {
        async generate(): Promise<string> {
          return 'not-json';
        }
      }
    });

    await expect(planner.plan('등산복', fakeScreenshot)).rejects.toThrow(/invalid json/i);
  });

  it('expands single-step draft into multi-step plan for complex task via second LVM call', async () => {
    const calls: string[] = [];
    const planner = new Planner({
      model: {
        async generate(input): Promise<string> {
          calls.push(input.prompt);
          if (calls.length === 1) {
            return JSON.stringify({
              screen_state: { has_obstacle: false },
              steps: [
                {
                  action_type: 'click',
                  target_description: '검색창',
                  keyword_weights: { 검색: 1.0 }
                }
              ]
            });
          }

          return JSON.stringify({
            steps: [
              {
                action_type: 'click',
                target_description: '스포츠/골프 메뉴',
                keyword_weights: { 스포츠: 0.8, 골프: 0.7 },
                target_viewport_xy: [0.16, 0.14],
                expected_result: '화면 변화'
              },
              {
                action_type: 'click',
                target_description: '여성스포츠의류 > 등산복',
                keyword_weights: { 여성: 0.6, 등산복: 0.9 },
                target_viewport_xy: [0.24, 0.22],
                expected_result: '화면 변화'
              },
              {
                action_type: 'click',
                target_description: '가격/색상 필터 적용',
                keyword_weights: { '10만원': 0.8, 붉은색: 0.9 },
                target_viewport_xy: [0.74, 0.31],
                expected_result: 'DOM 존재: .prod_list'
              }
            ]
          });
        }
      }
    });

    const result = await planner.plan(
      'danawa.com 에 가서 여성스포츠의류에서 등산복 중 10만원 이하 붉은색 상품 하나 찾아줘',
      fakeScreenshot
    );

    expect(calls.length).toBe(2);
    expect(result.steps.length).toBeGreaterThanOrEqual(3);
    expect(result.steps[0]?.targetDescription).toContain('스포츠');
  });

  it('uses deterministic multi-step fallback when expansion JSON is invalid', async () => {
    let callCount = 0;
    const planner = new Planner({
      model: {
        async generate(): Promise<string> {
          callCount += 1;
          if (callCount === 1) {
            return JSON.stringify({
              screen_state: { has_obstacle: false },
              steps: [
                {
                  action_type: 'click',
                  target_description: '검색창',
                  keyword_weights: { 검색: 1.0 }
                }
              ]
            });
          }
          return 'not-json';
        }
      }
    });

    const result = await planner.plan('카테고리 이동 후 필터 적용하고 결과 확인해줘', fakeScreenshot);
    expect(result.steps.length).toBe(3);
    expect(result.steps[0]?.targetDescription).toContain('상위 메뉴');
  });
});
