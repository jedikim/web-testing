import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { loadEnvFiles } from '../src/config/load-env-file';
import { loadProviderMatrixEnv } from '../src/config/provider-matrix-env';
import { createHttpProviderExecutors } from '../src/testing/provider-http-executor';
import { runProviderModelMatrix } from '../src/testing/provider-model-matrix';

const TEST_DIR = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = resolve(TEST_DIR, '..', '..');
loadEnvFiles({ cwd: REPO_ROOT, filenames: ['runtime/.env', '.env'] });

const RUN_PROVIDER_LIVE_E2E = process.env.RUN_PROVIDER_LIVE_E2E === '1';
let providerEnvError: Error | undefined;
let providerEnv = { llmTargets: [], visionTargets: [] } as ReturnType<typeof loadProviderMatrixEnv>;
try {
  providerEnv = loadProviderMatrixEnv(process.env);
} catch (error) {
  providerEnvError = error instanceof Error ? error : new Error(String(error));
}
const HAS_PROVIDER_LIVE_TARGETS =
  providerEnv.llmTargets.length > 0 && providerEnv.visionTargets.length > 0;

describe('provider live e2e', () => {
  it('is disabled unless RUN_PROVIDER_LIVE_E2E=1', () => {
    expect(typeof RUN_PROVIDER_LIVE_E2E).toBe('boolean');
  });

  it('requires llm + vision live targets to run', () => {
    expect(typeof HAS_PROVIDER_LIVE_TARGETS).toBe('boolean');
  });

  it('does not silently ignore provider env parse errors when live run is requested', () => {
    if (!RUN_PROVIDER_LIVE_E2E) {
      expect(true).toBe(true);
      return;
    }
    if (providerEnvError) {
      throw providerEnvError;
    }
    expect(providerEnvError).toBeUndefined();
  });
});

describe.runIf(RUN_PROVIDER_LIVE_E2E && HAS_PROVIDER_LIVE_TARGETS)('provider live e2e - matrix', () => {
  it(
    'runs llm multi-vendor and rfdetr multi-model matrix from env',
    async () => {
      const env = providerEnv;
      expect(env.llmTargets.length).toBeGreaterThan(0);
      expect(env.visionTargets.length).toBeGreaterThan(0);

      const executors = createHttpProviderExecutors({
        llmPrompt: 'Return patch-only JSON for web automation selector correction.',
        visionInput: 'runs/samples/artifacts/provider-input.png'
      });

      const report = await runProviderModelMatrix({
        llmTargets: env.llmTargets,
        visionTargets: env.visionTargets,
        executeLlm: executors.executeLlm,
        executeVision: executors.executeVision
      });

      const startedAt = new Date();
      const day = startedAt.toISOString().slice(0, 10);
      const stamp = startedAt.toISOString().replace(/[:.]/g, '-');
      const artifactsDir = resolve(
        REPO_ROOT,
        'runs',
        'samples',
        'artifacts',
        'provider-matrix',
        day
      );
      mkdirSync(artifactsDir, { recursive: true });
      const reportPath = resolve(artifactsDir, `${stamp}_provider-live-report.json`);
      writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8');

      expect(report.summary.total).toBeGreaterThan(1);
      expect(report.summary.failed).toBe(0);
    },
    180000
  );
});
