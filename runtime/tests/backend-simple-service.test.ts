import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { BackendSimpleService } from '../src/backend/simple-backend-service';
import { SessionStore } from '../src/session/store';

describe('BackendSimpleService', () => {
  it('creates sessions and appends user+assistant turns', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'backend-simple-service-'));

    try {
      const store = new SessionStore({
        rootDir: root,
        idGenerator: () => 'sess-service-1'
      });

      const service = new BackendSimpleService({
        store,
        engine: {
          async generate(input) {
            return {
              content: `assistant:${input.userMessage}`,
              metadata: {
                source: 'test-engine'
              }
            };
          }
        }
      });

      const session = await service.createSession({
        title: 'service test'
      });

      const updateEvents: string[] = [];
      const unsubscribe = service.onSessionUpdate(session.id, (updated) => {
        updateEvents.push(updated.updatedAt);
      });

      const output = await service.sendUserTurn({
        sessionId: session.id,
        content: 'run next',
        screenshotPath: '/tmp/a.png',
        metadata: {
          source: 'test'
        }
      });

      unsubscribe();

      expect(output.userTurn.role).toBe('user');
      expect(output.assistantTurn.role).toBe('assistant');
      expect(output.assistantTurn.content).toContain('assistant:run next');
      expect(output.session.turns.length).toBe(2);
      expect(updateEvents.length).toBeGreaterThan(0);

      await service.closeSession(session.id);

      await expect(
        service.sendUserTurn({
          sessionId: session.id,
          content: 'after close'
        })
      ).rejects.toThrow(/not active/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
