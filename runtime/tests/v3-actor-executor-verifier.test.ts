import { describe, expect, it, vi } from 'vitest';

import { Actor } from '../src/v3/actor';
import { Executor } from '../src/v3/executor';
import { ResultVerifier } from '../src/v3/result-verifier';
import type { ScoredNode, StepPlan } from '../src/v3/types';

describe('Week3 Actor/Executor/ResultVerifier', () => {
  it('actor selects top candidate and resolves viewport coordinates', async () => {
    const actor = new Actor();
    const step: StepPlan = {
      stepIndex: 1,
      actionType: 'click',
      targetDescription: '검색창',
      keywordWeights: { 검색: 1.0 }
    };

    const candidates: ScoredNode[] = [
      {
        node: {
          nodeId: 1,
          tag: 'input',
          text: '',
          attrs: { id: 'query' },
          axRole: 'textbox',
          axName: '통합검색'
        },
        score: 1.2,
        matches: []
      }
    ];

    const action = await actor.decide(step, candidates, {
      resolve: async () => ({
        xy: [0.34, 0.18],
        bbox: [0.31, 0.15, 0.37, 0.21]
      })
    });

    expect(action.selector).toBe('#query');
    expect(action.viewportXY).toEqual([0.34, 0.18]);
  });

  it('actor falls back to planner viewport target when candidate is missing', async () => {
    const actor = new Actor();
    const step: StepPlan = {
      stepIndex: 2,
      actionType: 'click',
      targetDescription: '돋보기 아이콘',
      targetViewportXY: [0.82, 0.12],
      keywordWeights: { 검색: 0.7 }
    };

    const action = await actor.decide(step, []);
    expect(action.selector).toBeNull();
    expect(action.viewportXY).toEqual([0.82, 0.12]);
  });

  it('executor prioritizes selector click and avoids fallback when selector succeeds', async () => {
    const browser = {
      clickSelector: vi.fn().mockResolvedValue(undefined),
      fillSelector: vi.fn().mockResolvedValue(undefined),
      mouseClick: vi.fn().mockResolvedValue(undefined),
      typeText: vi.fn().mockResolvedValue(undefined),
      getViewportSize: vi.fn().mockResolvedValue({ width: 1000, height: 800 })
    };

    const executor = new Executor();
    await executor.executeAction(
      {
        selector: '#query',
        actionType: 'click',
        viewportXY: [0.34, 0.18]
      },
      browser
    );

    expect(browser.clickSelector).toHaveBeenCalledTimes(1);
    expect(browser.mouseClick).not.toHaveBeenCalled();
  });

  it('executor falls back to viewport click when selector click fails', async () => {
    const browser = {
      clickSelector: vi.fn().mockRejectedValue(new Error('detached')),
      fillSelector: vi.fn().mockResolvedValue(undefined),
      mouseClick: vi.fn().mockResolvedValue(undefined),
      typeText: vi.fn().mockResolvedValue(undefined),
      getViewportSize: vi.fn().mockResolvedValue({ width: 1200, height: 900 })
    };

    const executor = new Executor();
    await executor.executeAction(
      {
        selector: '#query',
        actionType: 'click',
        viewportXY: [0.5, 0.2]
      },
      browser
    );

    expect(browser.clickSelector).toHaveBeenCalledTimes(1);
    expect(browser.mouseClick).toHaveBeenCalledWith(600, 180);
  });

  it('result verifier checks URL, DOM assertion, and visual fallback ordering', async () => {
    const verifier = new ResultVerifier();

    const urlOk = await verifier.verify({
      expectedResult: 'URL 변경: /search',
      preUrl: 'https://example.com',
      postUrl: 'https://example.com/search?q=등산복'
    });
    expect(urlOk).toBe('ok');

    const domOk = await verifier.verify({
      expectedResult: 'DOM 존재: .search-results',
      preUrl: 'https://example.com/search',
      postUrl: 'https://example.com/search',
      domExists: async (selector) => selector === '.search-results'
    });
    expect(domOk).toBe('ok');

    const visualFailed = await verifier.verify({
      expectedResult: '화면 변화',
      preUrl: 'https://example.com/list',
      postUrl: 'https://example.com/list',
      preVisualHash: 'aaaa',
      postVisualHash: 'aaaa'
    });
    expect(visualFailed).toBe('failed');
  });
});
