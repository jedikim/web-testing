import { describe, expect, it } from 'vitest';

import { SessionManager } from '../src/ops/session-manager';

describe('SessionManager', () => {
  it('tracks active sessions', () => {
    const manager = new SessionManager(2);
    expect(manager.startSession('s1')).toBe(true);
    expect(manager.startSession('s2')).toBe(true);
    expect(manager.getActiveSessions()).toEqual(['s1', 's2']);
  });

  it('rejects session start when max concurrency is reached', () => {
    const manager = new SessionManager(1);
    expect(manager.startSession('s1')).toBe(true);
    expect(manager.startSession('s2')).toBe(false);
  });

  it('frees capacity when session ends', () => {
    const manager = new SessionManager(1);
    manager.startSession('s1');
    manager.endSession('s1');
    expect(manager.startSession('s2')).toBe(true);
  });
});
