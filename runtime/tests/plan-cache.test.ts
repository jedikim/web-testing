import { describe, expect, it } from 'vitest';

import { PlanCache } from '../src/learning/plan-cache';

describe('PlanCache', () => {
  it('returns cache hit for similar goal/domain and adapts navigate step', () => {
    const cache = new PlanCache({ similarityThreshold: 0.35 });
    cache.storeTemplate({
      workflowId: 'wf-naver-weather',
      goal: '네이버 날씨 확인',
      domain: 'www.naver.com',
      steps: [
        { kind: 'analysis', title: 'Analyze objective' },
        { kind: 'navigate', title: 'Navigate target site https://www.naver.com' },
        { kind: 'verify', title: 'Verify result' }
      ],
      status: 'pass'
    });

    const match = cache.findBestMatch({
      workflowId: 'wf-naver-weather',
      goal: 'naver weather 확인',
      domain: 'map.naver.com'
    });

    expect(match).toBeDefined();
    expect(match?.score).toBeGreaterThan(0.35);
    const adapted = cache.adaptSteps(match!.template, {
      goal: 'naver weather 확인',
      domain: 'map.naver.com'
    });
    expect(adapted[1]?.title).toContain('https://map.naver.com');
  });

  it('decreases template quality score on repeated failures', () => {
    const cache = new PlanCache({ similarityThreshold: 0.2 });
    const stored = cache.storeTemplate({
      workflowId: 'wf-1',
      goal: 'sample',
      domain: 'example.com',
      steps: [{ kind: 'analysis', title: 'Analyze' }],
      status: 'pass'
    });

    cache.recordResult(stored.id, 'fail');
    cache.recordResult(stored.id, 'fail');

    const refreshed = cache.getById(stored.id);
    expect(refreshed?.failureCount).toBe(2);
    expect(refreshed?.qualityScore).toBeLessThan(0.8);
  });
});
