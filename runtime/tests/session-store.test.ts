import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { SessionStore } from '../src/session/store';

describe('SessionStore', () => {
  it('creates, appends, lists, and closes sessions', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'session-store-'));

    try {
      let tick = 0;
      const nowBase = new Date('2026-02-24T00:00:00.000Z').getTime();

      const store = new SessionStore({
        rootDir: root,
        idGenerator: () => 'sess-fixed',
        now: () => new Date(nowBase + tick++ * 1000)
      });

      const created = await store.create({
        mode: 'backend_simple',
        title: 'session-title',
        workflowId: 'wf-1',
        systemPrompt: 'Use deterministic-first policy.'
      });

      expect(created.id).toBe('sess-fixed');
      expect(created.turns.length).toBe(1);
      expect(created.turns[0]?.role).toBe('system');

      const withUser = await store.appendTurn(created.id, {
        role: 'user',
        content: 'Please run next step',
        screenshotPath: '/tmp/snap-1.png'
      });

      expect(withUser.turns.length).toBe(2);
      expect(withUser.turns[1]?.role).toBe('user');
      expect(withUser.turns[1]?.screenshotPath).toBe('/tmp/snap-1.png');

      const listed = await store.list();
      expect(listed.length).toBe(1);
      expect(listed[0]?.id).toBe(created.id);

      const closed = await store.close(created.id);
      expect(closed.status).toBe('closed');

      await expect(
        store.appendTurn(created.id, {
          role: 'user',
          content: 'should fail'
        })
      ).rejects.toThrow(/not active/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
