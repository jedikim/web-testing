import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { KR_LIVE_SCENARIOS } from '../src/e2e/kr-scenarios';

const RUN_KR_E2E = process.env.RUN_KR_E2E === '1';
const E2E_TIMEOUT_MS = 90000;
const TEST_DIR = fileURLToPath(new URL('.', import.meta.url));

describe('korean live smoke e2e', () => {
  it('is disabled unless RUN_KR_E2E=1', () => {
    expect(typeof RUN_KR_E2E).toBe('boolean');
  });
});

describe.runIf(RUN_KR_E2E)('korean live smoke e2e - scenarios', () => {
  for (const scenario of KR_LIVE_SCENARIOS) {
    it(
      scenario.id,
      async () => {
        const { chromium } = await import('playwright');
        const browser = await chromium.launch({ headless: true });

        try {
          const context = await browser.newContext({
            locale: 'ko-KR',
            timezoneId: 'Asia/Seoul'
          });
          const page = await context.newPage();

          await scenario.run(page);

          const startedAt = new Date();
          const day = startedAt.toISOString().slice(0, 10);
          const stamp = startedAt.toISOString().replace(/[:.]/g, '-');
          const artifactsDir = resolve(
            TEST_DIR,
            '..',
            '..',
            'runs',
            'samples',
            'artifacts',
            'e2e',
            day
          );
          mkdirSync(artifactsDir, { recursive: true });

          const screenshotPath = join(artifactsDir, `${stamp}_${scenario.id}.png`);
          await page.screenshot({ path: screenshotPath, fullPage: true });

          const reportPath = join(artifactsDir, `${stamp}_${scenario.id}.json`);
          writeFileSync(
            reportPath,
            JSON.stringify(
              {
                scenarioId: scenario.id,
                domain: scenario.domain,
                status: 'pass',
                url: page.url(),
                screenshotPath
              },
              null,
              2
            ),
            'utf-8'
          );

          await context.close();
        } finally {
          await browser.close();
        }
      },
      E2E_TIMEOUT_MS
    );
  }
});
