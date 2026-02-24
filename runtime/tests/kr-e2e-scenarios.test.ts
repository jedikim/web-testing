import { describe, expect, it } from 'vitest';

import { KR_LIVE_SCENARIOS } from '../src/e2e/kr-scenarios';

describe('KR_LIVE_SCENARIOS', () => {
  it('provides multiple Korean-site scenarios for live smoke e2e', () => {
    expect(KR_LIVE_SCENARIOS.length).toBeGreaterThanOrEqual(4);
    expect(KR_LIVE_SCENARIOS.every((scenario) => scenario.id.startsWith('kr_'))).toBe(true);
  });

  it('keeps scenario ids unique', () => {
    const ids = KR_LIVE_SCENARIOS.map((scenario) => scenario.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
