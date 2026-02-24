import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ChatAutomationService, type ChatAutomationSessionSnapshot } from '../src/backend/chat-automation-service';
import { SessionStore } from '../src/session/store';

function sleep(ms: number): Promise<void> {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, ms);
  });
}

async function waitForSnapshot(
  service: ChatAutomationService,
  sessionId: string,
  predicate: (snapshot: ChatAutomationSessionSnapshot) => boolean,
  timeoutMs = 5000
): Promise<ChatAutomationSessionSnapshot> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const snapshot = await service.getSnapshot(sessionId);
      if (predicate(snapshot)) {
        return snapshot;
      }
    } catch (error) {
      const message = (error as Error).message;
      if (
        !message.includes('Unexpected end of JSON input') &&
        !message.includes('session not found:')
      ) {
        throw error;
      }
    }
    await sleep(20);
  }

  throw new Error(`timeout waiting for session state: ${sessionId}`);
}

describe('ChatAutomationService', () => {
  it('runs a chat request and preserves selected browser mode', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'chat-automation-service-'));

    try {
      const store = new SessionStore({
        rootDir: root
      });
      const service = new ChatAutomationService({
        store,
        stepDelayMs: 15
      });
      await service.init();

      const created = await service.createSession({
        title: 'headful session',
        operatorId: 'op-1'
      });

      await service.sendMessage({
        sessionId: created.session.id,
        content: 'Open naver.com and summarize first page findings.',
        browserMode: 'headful',
        operatorId: 'op-1'
      });

      const done = await waitForSnapshot(
        service,
        created.session.id,
        (snapshot) => snapshot.run.status === 'completed'
      );

      expect(done.run.browserMode).toBe('headful');
      expect(done.run.queueLength).toBe(0);
      expect(done.logs.some((entry) => entry.message.includes('Run started (headful)'))).toBe(true);
      expect(done.logs.some((entry) => entry.message.includes('Run completed successfully'))).toBe(true);
      expect(done.session.turns.filter((turn) => turn.role === 'user').length).toBeGreaterThanOrEqual(1);
      expect(done.session.turns.filter((turn) => turn.role === 'assistant').length).toBeGreaterThanOrEqual(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('waits for captcha input and resumes after submit', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'chat-automation-captcha-'));

    try {
      const store = new SessionStore({
        rootDir: root
      });
      const service = new ChatAutomationService({
        store,
        stepDelayMs: 15
      });
      await service.init();

      const created = await service.createSession({
        title: 'captcha session',
        operatorId: 'op-2'
      });

      await service.sendMessage({
        sessionId: created.session.id,
        content: 'Login flow likely needs captcha verification.',
        browserMode: 'headless',
        operatorId: 'op-2'
      });

      const waiting = await waitForSnapshot(
        service,
        created.session.id,
        (snapshot) => snapshot.run.status === 'waiting_captcha'
      );

      expect(waiting.run.waitingCaptcha).toBe(true);
      expect(waiting.run.captchaPrompt).toContain('Security challenge');

      await service.submitCaptcha({
        sessionId: created.session.id,
        value: 'AB12C'
      });

      const done = await waitForSnapshot(
        service,
        created.session.id,
        (snapshot) => snapshot.run.status === 'completed'
      );

      expect(done.run.waitingCaptcha).toBe(false);
      expect(done.logs.some((entry) => entry.message.includes('Captcha accepted'))).toBe(true);
      expect(
        done.session.turns.some((turn) => turn.content.includes('Captcha value received. Continuing automation.'))
      ).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('auto-pauses previous session when another conversation starts and resumes safely', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'chat-automation-pause-'));

    try {
      const store = new SessionStore({
        rootDir: root
      });
      const service = new ChatAutomationService({
        store,
        stepDelayMs: 15
      });
      await service.init();

      const sessionA = await service.createSession({
        title: 'session-a',
        operatorId: 'shared-op'
      });
      const sessionB = await service.createSession({
        title: 'session-b',
        operatorId: 'shared-op'
      });

      await service.sendMessage({
        sessionId: sessionA.session.id,
        content: 'Start login and continue after captcha is solved.',
        browserMode: 'headful',
        operatorId: 'shared-op'
      });

      await waitForSnapshot(
        service,
        sessionA.session.id,
        (snapshot) => snapshot.run.status === 'waiting_captcha'
      );

      await service.sendMessage({
        sessionId: sessionB.session.id,
        content: 'Open google.com and complete quick search.',
        browserMode: 'headless',
        operatorId: 'shared-op',
        autoPauseOthers: true
      });

      const pausedA = await waitForSnapshot(
        service,
        sessionA.session.id,
        (snapshot) => snapshot.run.status === 'paused'
      );
      expect(pausedA.run.waitingCaptcha).toBe(true);

      const doneB = await waitForSnapshot(
        service,
        sessionB.session.id,
        (snapshot) => snapshot.run.status === 'completed'
      );
      expect(doneB.run.status).toBe('completed');

      await service.submitCaptcha({
        sessionId: sessionA.session.id,
        value: 'ZYX12'
      });

      const stillPaused = await waitForSnapshot(
        service,
        sessionA.session.id,
        (snapshot) => snapshot.run.status === 'paused' && snapshot.run.waitingCaptcha === false
      );
      expect(stillPaused.run.status).toBe('paused');

      await service.resumeSession(sessionA.session.id);

      const doneA = await waitForSnapshot(
        service,
        sessionA.session.id,
        (snapshot) => snapshot.run.status === 'completed'
      );
      expect(doneA.run.status).toBe('completed');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
