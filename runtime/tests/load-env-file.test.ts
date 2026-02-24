import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadEnvFiles } from '../src/config/load-env-file';

describe('loadEnvFiles', () => {
  it('loads key/value pairs from listed env files without overriding existing values', () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'env-loader-'));
    mkdirSync(join(tempRoot, 'runtime'), { recursive: true });

    writeFileSync(
      join(tempRoot, 'runtime', '.env'),
      [
        '# runtime env',
        'RUN_PROVIDER_LIVE_E2E=1',
        'GEMINI_API_KEY="gm-key"',
        'OPENAI_API_KEY=oa-from-runtime'
      ].join('\n'),
      'utf-8'
    );
    writeFileSync(
      join(tempRoot, '.env'),
      ['OPENAI_API_KEY=oa-from-root', "GEMINI_MODELS='gemini-3.1-pro-preview,gemini-3.0-flash'"].join('\n'),
      'utf-8'
    );

    const target: NodeJS.ProcessEnv = { OPENAI_API_KEY: 'preset-key' };
    const result = loadEnvFiles({
      cwd: tempRoot,
      filenames: ['runtime/.env', '.env'],
      target
    });

    expect(result.loadedFiles).toHaveLength(2);
    expect(target.RUN_PROVIDER_LIVE_E2E).toBe('1');
    expect(target.GEMINI_API_KEY).toBe('gm-key');
    expect(target.OPENAI_API_KEY).toBe('preset-key');
    expect(target.GEMINI_MODELS).toBe('gemini-3.1-pro-preview,gemini-3.0-flash');
  });

  it('supports export prefix and override mode', () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'env-loader-'));
    writeFileSync(join(tempRoot, '.env'), 'export OPENAI_API_KEY=oa-updated', 'utf-8');

    const target: NodeJS.ProcessEnv = { OPENAI_API_KEY: 'old' };
    loadEnvFiles({
      cwd: tempRoot,
      filenames: ['.env'],
      target,
      override: true
    });

    expect(target.OPENAI_API_KEY).toBe('oa-updated');
  });
});
