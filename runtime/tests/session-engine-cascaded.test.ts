import { describe, expect, it } from 'vitest';

import {
  CascadedTurnEngine,
  type GenerateTurnInput,
  type GenerateTurnOutput,
  type MultiTurnEngine
} from '../src/session/engine';

class StubEngine implements MultiTurnEngine {
  constructor(private readonly handler: (input: GenerateTurnInput) => Promise<GenerateTurnOutput>) {}

  async generate(input: GenerateTurnInput): Promise<GenerateTurnOutput> {
    return this.handler(input);
  }
}

function input(message: string): GenerateTurnInput {
  return {
    session: {
      id: 'sess-1',
      mode: 'backend_simple',
      status: 'active',
      createdAt: '2026-02-24T00:00:00.000Z',
      updatedAt: '2026-02-24T00:00:00.000Z',
      turns: []
    },
    userMessage: message
  };
}

describe('CascadedTurnEngine', () => {
  it('keeps flash result when confidence is high and request is non-sensitive', async () => {
    const engine = new CascadedTurnEngine({
      primary: new StubEngine(async () => ({
        content: 'Use deterministic flow. Click search and verify result marker.',
        metadata: { confidence: 0.9 }
      })),
      escalation: new StubEngine(async () => ({
        content: 'pro response'
      })),
      fallback: new StubEngine(async () => ({
        content: 'rule response'
      }))
    });

    const result = await engine.generate(input('Open naver and search weather'));
    expect(result.content).toContain('deterministic flow');
    expect((result.metadata as Record<string, unknown>)?.cascadeTier).toBe('flash');
    expect((result.metadata as Record<string, unknown>)?.escalated).toBe(false);
  });

  it('escalates to pro when request is sensitive', async () => {
    const engine = new CascadedTurnEngine({
      primary: new StubEngine(async () => ({
        content: 'Try login maybe?',
        metadata: { confidence: 0.95 }
      })),
      escalation: new StubEngine(async () => ({
        content: 'Sensitive flow: require explicit checkpoint before credential submission.'
      }))
    });

    const result = await engine.generate(input('로그인 후 결제까지 진행해'));
    expect(result.content).toContain('Sensitive flow');
    expect((result.metadata as Record<string, unknown>)?.cascadeTier).toBe('pro');
    expect((result.metadata as Record<string, unknown>)?.escalated).toBe(true);
  });

  it('falls back to rule engine when both flash and pro fail', async () => {
    const engine = new CascadedTurnEngine({
      primary: new StubEngine(async () => {
        throw new Error('flash unavailable');
      }),
      escalation: new StubEngine(async () => {
        throw new Error('pro unavailable');
      }),
      fallback: new StubEngine(async () => ({
        content: 'Rule fallback guidance'
      }))
    });

    const result = await engine.generate(input('any'));
    expect(result.content).toContain('Rule fallback');
    expect((result.metadata as Record<string, unknown>)?.cascadeTier).toBe('rule_fallback');
    expect((result.metadata as Record<string, unknown>)?.escalated).toBe(true);
  });
});
