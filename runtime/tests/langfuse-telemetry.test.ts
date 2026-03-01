import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  __resetLangfuseTelemetryForTests,
  getLangfuseTelemetry
} from '../src/telemetry/langfuse';

const TRACKED_KEYS = [
  'LANGFUSE_ENABLED',
  'LANGFUSE_PUBLIC_KEY',
  'LANGFUSE_SECRET_KEY',
  'LANGFUSE_BASE_URL',
  'LANGFUSE_TIMEOUT_SECONDS',
  'LANGFUSE_ENV',
  'LANGFUSE_RELEASE'
] as const;

type TrackedKey = (typeof TRACKED_KEYS)[number];
type EnvSnapshot = Record<TrackedKey, string | undefined>;

function takeSnapshot(): EnvSnapshot {
  return TRACKED_KEYS.reduce((accumulator, key) => {
    accumulator[key] = process.env[key];
    return accumulator;
  }, {} as EnvSnapshot);
}

function clearTrackedEnv(): void {
  for (const key of TRACKED_KEYS) {
    delete process.env[key];
  }
}

function restoreSnapshot(snapshot: EnvSnapshot): void {
  for (const key of TRACKED_KEYS) {
    const value = snapshot[key];
    if (typeof value === 'string') {
      process.env[key] = value;
    } else {
      delete process.env[key];
    }
  }
}

describe('langfuse telemetry env toggle', () => {
  let snapshot: EnvSnapshot;

  beforeEach(() => {
    snapshot = takeSnapshot();
    clearTrackedEnv();
    __resetLangfuseTelemetryForTests();
  });

  afterEach(() => {
    restoreSnapshot(snapshot);
    __resetLangfuseTelemetryForTests();
  });

  it('returns noop telemetry when LANGFUSE_ENABLED is disabled', async () => {
    process.env.LANGFUSE_ENABLED = '0';

    const telemetry = getLangfuseTelemetry();
    expect(telemetry.enabled).toBe(false);
    expect(telemetry.initWarning).toBeUndefined();

    const span = telemetry.startSpan('chat_automation.test');
    expect(span.context).toBeUndefined();
    span.setAttribute('k', 'v');
    span.addEvent('noop_event');
    span.endSuccess();

    await expect(telemetry.flush()).resolves.toBeUndefined();
  });

  it('falls back to noop telemetry with warning when keys are missing', async () => {
    process.env.LANGFUSE_ENABLED = '1';

    const telemetry = getLangfuseTelemetry();
    expect(telemetry.enabled).toBe(false);
    expect(telemetry.initWarning).toContain(
      'LANGFUSE_ENABLED=1 but LANGFUSE_PUBLIC_KEY/LANGFUSE_SECRET_KEY is missing'
    );

    const span = telemetry.startSpan('chat_automation.test');
    span.endError(new Error('expected-noop'));
    await expect(telemetry.flush()).resolves.toBeUndefined();
  });
});
