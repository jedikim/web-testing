import { describe, expect, it } from 'vitest';

import { pickViewMode } from '../src/live/view-mode';

describe('pickViewMode', () => {
  it('prefers screencast when available and healthy', () => {
    const mode = pickViewMode({
      screencastAvailable: true,
      screencastHealthy: true
    });

    expect(mode).toBe('screencast');
  });

  it('falls back to screenshot when screencast is unavailable', () => {
    const mode = pickViewMode({
      screencastAvailable: false,
      screencastHealthy: false
    });

    expect(mode).toBe('screenshot');
  });
});
