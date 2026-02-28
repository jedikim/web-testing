import { describe, expect, it } from 'vitest';

import { RetryPolicy } from '../src/v3/retry-policy';

describe('Week6 RetryPolicy', () => {
  it('retries on transient error before max attempts', () => {
    const policy = new RetryPolicy();
    const decision = policy.decide({
      attempt: 1,
      maxAttempts: 3,
      error: new Error('Timeout while waiting for selector')
    });

    expect(decision.shouldRetry).toBe(true);
    expect(decision.reason).toBe('transient_error_retry');
  });

  it('does not retry on non-transient error', () => {
    const policy = new RetryPolicy();
    const decision = policy.decide({
      attempt: 1,
      maxAttempts: 3,
      error: new Error('invalid selector syntax')
    });

    expect(decision.shouldRetry).toBe(false);
    expect(decision.reason).toBe('non_transient_error');
  });

  it('stops when max attempts reached', () => {
    const policy = new RetryPolicy();
    const decision = policy.decide({
      attempt: 3,
      maxAttempts: 3,
      verification: 'failed'
    });
    expect(decision.shouldRetry).toBe(false);
    expect(decision.reason).toBe('max_attempts_reached');
  });
});
