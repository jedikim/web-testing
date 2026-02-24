import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { chromium } from 'playwright';
import { describe, expect, it } from 'vitest';

import { PlaywrightExecutorAdapter } from '../src/engine/playwright-executor';

describe('fixture e2e: playwright adapter', () => {
  it('executes deterministic type/click/wait flow on fixture page', async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    try {
      const fixturePath = resolve(process.cwd(), 'tests', 'e2e-fixtures', 'deterministic-form.html');
      await page.goto(pathToFileURL(fixturePath).href);

      const adapter = new PlaywrightExecutorAdapter(page as never);
      expect(
        await adapter.executeAction({
          op: 'type',
          target: '#query',
          args: { value: 'pangyo' }
        })
      ).toEqual({ ok: true });
      expect(
        await adapter.executeAction({
          op: 'click',
          target: '#run'
        })
      ).toEqual({ ok: true });

      const waited = await adapter.executeAction({
        op: 'wait_for',
        target: '#result[data-ready="1"]'
      });
      expect(waited.ok).toBe(true);

      const resultText = await page.textContent('#result');
      expect(resultText).toBe('pangyo');
    } finally {
      await page.close();
      await browser.close();
    }
  });

  it('executes deterministic select_option flow on fixture page', async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    try {
      const fixturePath = resolve(process.cwd(), 'tests', 'e2e-fixtures', 'deterministic-form.html');
      await page.goto(pathToFileURL(fixturePath).href);

      const adapter = new PlaywrightExecutorAdapter(page as never);
      expect(
        await adapter.executeAction({
          op: 'select_option',
          target: '#sort',
          args: { value: 'price' }
        })
      ).toEqual({ ok: true });

      const waited = await adapter.executeAction({
        op: 'wait_for',
        target: '#sort-value[data-ready="1"]'
      });
      expect(waited.ok).toBe(true);

      const resultText = await page.textContent('#sort-value');
      expect(resultText).toBe('price');
    } finally {
      await page.close();
      await browser.close();
    }
  });
});
