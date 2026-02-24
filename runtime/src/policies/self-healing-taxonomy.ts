import type { FailureCode } from '../types';

export type HealingCategory =
  | 'selector'
  | 'timing'
  | 'data'
  | 'runtime'
  | 'rendering'
  | 'interaction'
  | 'auth'
  | 'unknown';

export interface ClassifyFailureInput {
  failureCode: FailureCode;
  message?: string;
}

function normalize(raw: string | undefined): string {
  return (raw ?? '').trim().toLowerCase();
}

export function classifyFailureCode(input: ClassifyFailureInput): FailureCode {
  const code = input.failureCode;
  const message = normalize(input.message);

  if (code !== 'Unknown') {
    if (code === 'ActionNotApplied' && /(not visible|cannot be clicked|not clickable|covered|obscured)/i.test(message)) {
      return 'HiddenElement';
    }
    if (code === 'ExpectationFailed' && /(expected .* but got|mismatch|different value|date|price|금액|날짜)/i.test(message)) {
      return 'DataMismatch';
    }
    return code;
  }

  if (/(timeout|timed out|waiting for selector|wait for|navigation timeout)/i.test(message)) {
    return 'TimingTimeout';
  }

  if (/(econnreset|enotfound|err_connection|network|dns|temporarily unavailable|502|503|504)/i.test(message)) {
    return 'NetworkTransient';
  }

  if (/(not visible|cannot be clicked|hidden|detached from dom|intercepted click)/i.test(message)) {
    return 'HiddenElement';
  }

  if (/(expected .* but got|mismatch|wrong value|invalid value|date|price|금액|날짜)/i.test(message)) {
    return 'DataMismatch';
  }

  if (/(hydration|skeleton|blank page|render|not rendered|paint)/i.test(message)) {
    return 'RenderBlocked';
  }

  if (/(target closed|browser has disconnected|context closed|page crashed|runtime error)/i.test(message)) {
    return 'RuntimeCrash';
  }

  return 'Unknown';
}

export function healingCategoryFor(code: FailureCode): HealingCategory {
  if (code === 'SelectorNotFound') {
    return 'selector';
  }

  if (code === 'TimingTimeout' || code === 'NetworkTransient') {
    return 'timing';
  }

  if (code === 'DataMismatch') {
    return 'data';
  }

  if (code === 'RuntimeCrash') {
    return 'runtime';
  }

  if (code === 'RenderBlocked' || code === 'VisualAmbiguity') {
    return 'rendering';
  }

  if (code === 'HiddenElement' || code === 'ActionNotApplied') {
    return 'interaction';
  }

  if (code === 'AuthBlocked' || code === 'ReviewRejected') {
    return 'auth';
  }

  return 'unknown';
}

export function suggestedHealingAction(code: FailureCode): string {
  switch (healingCategoryFor(code)) {
    case 'selector':
      return 'Apply selector fingerprint recovery (Similo) and retry with bounded attempts.';
    case 'timing':
      return 'Increase adaptive timeout, add explicit wait condition, and retry once.';
    case 'data':
      return 'Re-evaluate extracted data format and run data validation before final assert.';
    case 'runtime':
      return 'Restart browser context/session and resume from the latest stable checkpoint.';
    case 'rendering':
      return 'Wait for hydration/render completion, capture screenshot, then retry verification.';
    case 'interaction':
      return 'Insert pre-step to open menu/tab/accordion so hidden element becomes interactable.';
    case 'auth':
      return 'Trigger human handoff immediately; do not bypass security challenge.';
    default:
      return 'Capture diagnostic screenshot/log and escalate to planner for patch-only correction.';
  }
}
