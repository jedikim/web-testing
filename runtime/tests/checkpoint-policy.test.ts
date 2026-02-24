import { describe, expect, it } from 'vitest';

import { evaluateCheckpoint } from '../src/checkpoint/go-no-go';

describe('evaluateCheckpoint', () => {
  it('returns ask_user when confidence is below threshold', () => {
    const result = evaluateCheckpoint({
      confidence: 0.45,
      threshold: 0.8,
      sensitiveAction: false
    });

    expect(result.decision).toBe('ask_user');
  });

  it('blocks sensitive actions without explicit approval', () => {
    const result = evaluateCheckpoint({
      confidence: 0.95,
      threshold: 0.8,
      sensitiveAction: true
    });

    expect(result.decision).toBe('not_go');
  });

  it('allows flow when confidence is sufficient and approved', () => {
    const result = evaluateCheckpoint({
      confidence: 0.92,
      threshold: 0.8,
      sensitiveAction: true,
      userApproval: true
    });

    expect(result.decision).toBe('go');
  });
});
