export interface RetryPolicyInput {
  attempt: number;
  maxAttempts: number;
  error?: unknown;
  verification?: 'ok' | 'wrong' | 'failed';
}

export interface RetryPolicyDecision {
  shouldRetry: boolean;
  reason: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? '');
}

function isTransientError(message: string): boolean {
  return /(timeout|detached|intercept|navigation|context|temporar|network|closed)/i.test(message);
}

export class RetryPolicy {
  decide(input: RetryPolicyInput): RetryPolicyDecision {
    if (input.attempt >= input.maxAttempts) {
      return {
        shouldRetry: false,
        reason: 'max_attempts_reached'
      };
    }

    if (input.verification === 'wrong') {
      return {
        shouldRetry: true,
        reason: 'wrong_target_retry'
      };
    }

    if (input.verification === 'failed') {
      return {
        shouldRetry: true,
        reason: 'no_effect_retry'
      };
    }

    if (input.error) {
      const message = errorMessage(input.error);
      if (isTransientError(message)) {
        return {
          shouldRetry: true,
          reason: 'transient_error_retry'
        };
      }
      return {
        shouldRetry: false,
        reason: 'non_transient_error'
      };
    }

    return {
      shouldRetry: false,
      reason: 'no_retry_condition'
    };
  }
}
