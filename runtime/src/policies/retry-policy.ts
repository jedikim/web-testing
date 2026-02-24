import type { FailureCode } from '../types';

export interface RetryPolicyInput {
  attempt: number;
  maxAttempts: number;
  failureCode: FailureCode;
}

const NON_RETRYABLE_CODES = new Set<FailureCode>(['AuthBlocked', 'ReviewRejected']);

export function shouldRetry(input: RetryPolicyInput): boolean {
  if (input.attempt >= input.maxAttempts) {
    return false;
  }

  return !NON_RETRYABLE_CODES.has(input.failureCode);
}
