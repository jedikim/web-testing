import { describe, expect, it } from 'vitest';

import { shouldRetry } from '../src/policies/retry-policy';

describe('shouldRetry', () => {
  it('retries recoverable failures while attempts remain', () => {
    expect(
      shouldRetry({
        attempt: 1,
        maxAttempts: 3,
        failureCode: 'SelectorNotFound'
      })
    ).toBe(true);
  });

  it('does not retry when max attempts reached', () => {
    expect(
      shouldRetry({
        attempt: 3,
        maxAttempts: 3,
        failureCode: 'ActionNotApplied'
      })
    ).toBe(false);
  });

  it('does not retry blocked/auth cases', () => {
    expect(
      shouldRetry({
        attempt: 1,
        maxAttempts: 3,
        failureCode: 'AuthBlocked'
      })
    ).toBe(false);
  });

  it('does not retry review rejected cases', () => {
    expect(
      shouldRetry({
        attempt: 1,
        maxAttempts: 3,
        failureCode: 'ReviewRejected'
      })
    ).toBe(false);
  });

  it('retries timing/network/render related transient failures', () => {
    expect(
      shouldRetry({
        attempt: 1,
        maxAttempts: 3,
        failureCode: 'TimingTimeout'
      })
    ).toBe(true);

    expect(
      shouldRetry({
        attempt: 1,
        maxAttempts: 3,
        failureCode: 'NetworkTransient'
      })
    ).toBe(true);
  });
});
