import { describe, expect, it } from 'vitest';

import { runProviderModelMatrix } from '../src/testing/provider-model-matrix';

describe('runProviderModelMatrix', () => {
  it('executes all llm and yolo26 models in matrix', async () => {
    const llmCalls: string[] = [];
    const visionCalls: string[] = [];

    const report = await runProviderModelMatrix({
      llmTargets: [
        {
          provider: 'gemini',
          apiKey: 'gm-key',
          models: ['gemini-2.0-flash', 'gemini-1.5-pro']
        },
        {
          provider: 'openai',
          apiKey: 'oa-key',
          models: ['gpt-4.1-mini']
        }
      ],
      visionTargets: [
        {
          provider: 'yolo26',
          apiKey: 'yo-key',
          baseUrl: 'https://vision.local',
          models: ['yolo26n', 'yolo26s']
        }
      ],
      executeLlm: async (target) => {
        llmCalls.push(`${target.provider}:${target.model}`);
        return { ok: true };
      },
      executeVision: async (target) => {
        visionCalls.push(`${target.provider}:${target.model}`);
        return { ok: true };
      }
    });

    expect(report.summary.total).toBe(5);
    expect(report.summary.passed).toBe(5);
    expect(report.summary.failed).toBe(0);
    expect(llmCalls).toEqual([
      'gemini:gemini-2.0-flash',
      'gemini:gemini-1.5-pro',
      'openai:gpt-4.1-mini'
    ]);
    expect(visionCalls).toEqual(['yolo26:yolo26n', 'yolo26:yolo26s']);
  });

  it('collects failure rows without aborting the full matrix', async () => {
    const report = await runProviderModelMatrix({
      llmTargets: [
        {
          provider: 'anthropic',
          apiKey: 'an-key',
          models: ['claude-3-5-sonnet-latest']
        },
        {
          provider: 'openai',
          apiKey: 'oa-key',
          models: ['gpt-4.1-mini']
        }
      ],
      visionTargets: [],
      executeLlm: async (target) => {
        if (target.provider === 'anthropic') {
          return { ok: false, error: 'quota exceeded' };
        }
        return { ok: true };
      },
      executeVision: async () => ({ ok: true })
    });

    expect(report.summary.total).toBe(2);
    expect(report.summary.passed).toBe(1);
    expect(report.summary.failed).toBe(1);
    expect(report.rows.find((row) => row.provider === 'anthropic')?.status).toBe('fail');
    expect(report.rows.find((row) => row.provider === 'anthropic')?.error).toMatch(
      /quota exceeded/
    );
  });
});
