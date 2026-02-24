import { describe, expect, it } from 'vitest';

import { pickViewMode } from '../src/view/view-mode';

describe('pickViewMode', () => {
  it('returns screenshot mode by default', () => {
    const mode = pickViewMode();

    expect(mode).toBe('screenshot');
  });

  it('keeps screenshot mode when checkpoint is forced', () => {
    const mode = pickViewMode({
      forceCheckpoint: true
    });

    expect(mode).toBe('screenshot');
  });
});
