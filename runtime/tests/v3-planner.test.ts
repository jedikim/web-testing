import { describe, expect, it } from 'vitest';

import { Planner, buildPlannerPrompt } from '../src/v3/planner';

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
});
