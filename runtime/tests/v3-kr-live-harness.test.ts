import { describe, expect, it } from 'vitest';

import { KR_LIVE_SCENARIOS } from '../src/e2e/kr-scenarios';

const RUN_LIVE = process.env.RUN_KR_E2E === '1';
const itLive = RUN_LIVE ? it : it.skip;

describe('Week6 KR site harness', () => {
  it('keeps a non-empty KR live scenario catalog', () => {
    expect(KR_LIVE_SCENARIOS.length).toBeGreaterThanOrEqual(3);
    expect(KR_LIVE_SCENARIOS.every((scenario) => scenario.domain.includes('.'))).toBe(true);
  });

  itLive('executes a KR live subset with env toggle', async () => {
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({
      headless: process.env.PW_HEADLESS !== '0'
    });
    const page = await browser.newPage();

    const subset = KR_LIVE_SCENARIOS.slice(0, 3);
    let passCount = 0;

    try {
      for (const scenario of subset) {
        try {
          await scenario.run(page);
          passCount += 1;
        } catch {
          // continue to next scenario; aggregate success rate is asserted below
        }
      }
    } finally {
      await browser.close();
    }

    const successRate = passCount / subset.length;
    expect(successRate).toBeGreaterThanOrEqual(0.8);
  }, 180000);
});
