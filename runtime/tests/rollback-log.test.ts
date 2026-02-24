import { describe, expect, it } from 'vitest';

import { RollbackLog } from '../src/ops/rollback-log';

describe('RollbackLog', () => {
  it('stores rollback entries and retrieves latest', () => {
    const log = new RollbackLog();
    log.add({
      changeId: 'chg-1',
      reason: 'selector regression',
      timestamp: '2026-02-24T10:00:00Z'
    });
    log.add({
      changeId: 'chg-2',
      reason: 'latency spike',
      timestamp: '2026-02-24T10:10:00Z'
    });

    expect(log.latest()?.changeId).toBe('chg-2');
  });

  it('filters entries by change id', () => {
    const log = new RollbackLog();
    log.add({ changeId: 'chg-1', reason: 'one', timestamp: '2026-02-24T10:00:00Z' });
    log.add({ changeId: 'chg-2', reason: 'two', timestamp: '2026-02-24T10:10:00Z' });
    log.add({ changeId: 'chg-1', reason: 'three', timestamp: '2026-02-24T10:20:00Z' });

    expect(log.byChangeId('chg-1')).toHaveLength(2);
  });
});
