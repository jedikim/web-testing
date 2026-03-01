import { describe, expect, it } from 'vitest';

import { runProviderModelMatrix } from '../src/testing/provider-model-matrix';

describe('runProviderModelMatrix', () => {
  it('executes all llm and rfdetr models in matrix', async () => {
    const llmCalls: string[] = [];
    const visionCalls: string[] = [];

    const report = await runProviderModelMatrix({
      llmTargets: [
        {
          provider: 'gemini',
          apiKey: 'gm-key',
          models: ['gemini-3.1-pro-preview', 'gemini-3-flash-preview']
        },
        {
          provider: 'openai',
          apiKey: 'oa-key',
          models: ['gpt-5-codex', 'gpt-5-mini']
        }
      ],
      visionTargets: [
        {
          provider: 'rfdetr',
          apiKey: 'yo-key',
          baseUrl: 'https://vision.local',
          models: ['rf-detr-medium']
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
      'gemini:gemini-3.1-pro-preview',
      'gemini:gemini-3-flash-preview',
      'openai:gpt-5-codex',
      'openai:gpt-5-mini'
    ]);
    expect(visionCalls).toEqual(['rfdetr:rf-detr-medium']);
  });

  it('collects failure rows without aborting the full matrix', async () => {
    const report = await runProviderModelMatrix({
      llmTargets: [
        {
          provider: 'gemini',
          apiKey: 'gm-key',
          models: ['gemini-3.1-pro-preview']
        },
        {
          provider: 'openai',
          apiKey: 'oa-key',
          models: ['gpt-5-mini']
        }
      ],
      visionTargets: [],
      executeLlm: async (target) => {
        if (target.provider === 'gemini') {
          return { ok: false, error: 'quota exceeded' };
        }
        return { ok: true };
      },
      executeVision: async () => ({ ok: true })
    });

    expect(report.summary.total).toBe(2);
    expect(report.summary.passed).toBe(1);
    expect(report.summary.failed).toBe(1);
    expect(report.rows.find((row) => row.provider === 'gemini')?.status).toBe('fail');
    expect(report.rows.find((row) => row.provider === 'gemini')?.error).toMatch(
      /quota exceeded/
    );
  });
});
