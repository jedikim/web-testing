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
  timeoutMs = 12000
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
        !message.includes('Unterminated string in JSON') &&
        !message.includes('session not found:')
      ) {
        throw error;
      }
    }
    await sleep(20);
  }

  throw new Error(`timeout waiting for session state: ${sessionId}`);
}

describe('ChatAutomationService', { timeout: 15_000 }, () => {
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

      expect(done.schemaVersion).toBe('chat.session.snapshot.v1');
      expect(done.run.browserMode).toBe('headful');
      expect(done.run.queueLength).toBe(0);
      expect(done.logs.some((entry) => entry.message.includes('Run started (headful)'))).toBe(true);
      expect(done.logs.some((entry) => entry.message.includes('Planner mode:'))).toBe(true);
      expect(done.logs.some((entry) => entry.message.includes('Automation LLM tier policy:'))).toBe(true);
      expect(done.logs.some((entry) => entry.message.includes('Task analysis:'))).toBe(true);
      expect(done.logs.some((entry) => entry.message.includes('Run completed successfully'))).toBe(true);
      expect(done.session.turns.filter((turn) => turn.role === 'user').length).toBeGreaterThanOrEqual(1);
      expect(done.session.turns.filter((turn) => turn.role === 'assistant').length).toBeGreaterThanOrEqual(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('detects bare domain targets and avoids misreading size numbers as summary count', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'chat-automation-domain-count-'));

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
        title: 'domain and count parse',
        operatorId: 'op-parse'
      });

      await service.sendMessage({
        sessionId: created.session.id,
        content: 'danawa.com 에 가서 55인치 tv 중 가장 저렴한 tv 5종류만 리스팅해줘.',
        browserMode: 'headful',
        operatorId: 'op-parse'
      });

      const done = await waitForSnapshot(
        service,
        created.session.id,
        (snapshot) => snapshot.run.status === 'completed'
      );

      expect(
        done.logs.some((entry) => entry.message.includes('target=https://danawa.com'))
      ).toBe(true);
      expect(done.logs.some((entry) => entry.message.includes('target=https://example.com'))).toBe(false);
      expect(done.logs.some((entry) => entry.message.includes('Summary intent detected (limit=5)'))).toBe(
        true
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('extracts generic listing constraints (one item, budget, color) from user request', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'chat-automation-danawa-filter-'));

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
        title: 'listing filter parse',
        operatorId: 'op-filter'
      });

      await service.sendMessage({
        sessionId: created.session.id,
        content:
          'danawa.com 에 가서 여성스포츠의류 에서 등산복 중에서 10만원 이하의 등산복중에서 붉은색 옷을 찾아줘 하나만',
        browserMode: 'headful',
        operatorId: 'op-filter'
      });

      const done = await waitForSnapshot(
        service,
        created.session.id,
        (snapshot) => snapshot.run.status === 'completed'
      );

      expect(done.logs.some((entry) => entry.message.includes('target=https://danawa.com'))).toBe(true);
      expect(done.logs.some((entry) => entry.message.includes('Summary intent detected (limit=1)'))).toBe(
        true
      );
      expect(done.logs.some((entry) => entry.message.includes('Hierarchy hint groups:'))).toBe(true);
      expect(
        done.logs.some(
          (entry) =>
            entry.message.includes('Hierarchy hint groups:') &&
            /com\s*에\s*가서/i.test(entry.message)
        )
      ).toBe(false);
      expect(done.logs.some((entry) => entry.message.includes('Task staged approach:'))).toBe(true);
      expect(done.logs.some((entry) => entry.message.includes('Task strategy options:'))).toBe(true);
      expect(done.logs.some((entry) => entry.message.includes('Required keywords:'))).toBe(true);
      expect(done.logs.some((entry) => entry.message.includes('Search query seed:'))).toBe(true);
      expect(
        done.logs.some(
          (entry) =>
            entry.message.includes('Listing filter:') &&
            entry.message.includes('"requireRedColor":true') &&
            entry.message.includes('"maxLumpSum":100000')
        )
      ).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('injects hierarchy-first + explicit constraint probes for strict ecommerce listing tasks', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'chat-automation-danawa-constraint-probe-'));
    const previousPlannerMode = process.env.CHAT_AUTOMATION_PLANNER_MODE;
    process.env.CHAT_AUTOMATION_PLANNER_MODE = 'rule_first';

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
        title: 'hierarchy + constraint probe',
        operatorId: 'op-probe'
      });

      await service.sendMessage({
        sessionId: created.session.id,
        content:
          'danawa.com 에 가서 여성스포츠의류 에서 등산복 중에서 10만원 이하의 등산복중에서 붉은색 옷을 찾아줘 하나만',
        browserMode: 'headful',
        operatorId: 'op-probe'
      });

      const done = await waitForSnapshot(
        service,
        created.session.id,
        (snapshot) => snapshot.run.status === 'completed'
      );

      expect(
        done.logs.some(
          (entry) =>
            entry.message.includes('Planner action') &&
            (entry.message.includes('rule_fallback_hierarchy_level_2') ||
              entry.message.includes('deterministic_hierarchy_probe') ||
              entry.message.includes('auto_added_hierarchy_group_2'))
        )
      ).toBe(true);
      expect(
        done.logs.some(
          (entry) =>
            entry.message.includes('Planner action') &&
            (entry.message.includes('rule_fallback_constraint_probe') ||
              entry.message.includes('auto_added_constraint_probe_attempt_') ||
              entry.message.includes('stepwise-stage gate'))
        )
      ).toBe(true);
      expect(
        done.logs.some((entry) => entry.message.includes('search fallback actions deferred until attempt>=3'))
      ).toBe(true);
      expect(
        done.logs.some(
          (entry) =>
            (/Simulated action click:/i.test(entry.message) &&
              /(필터|조건|filter|sort|price)/i.test(entry.message)) ||
            /root-filter guard/i.test(entry.message) ||
            /stepwise-stage gate: filter stage is blocked/i.test(entry.message)
        )
      ).toBe(true);
      expect(
        done.logs.some((entry) => entry.message.includes('Category context gate active'))
      ).toBe(true);
      expect(
        done.logs.some(
          (entry) =>
            entry.message.includes('skipped by category-context gate') ||
            entry.message.includes('Hint dead-end guard activated')
        )
      ).toBe(true);
      expect(
        done.logs.some((entry) => entry.message.includes('Listing strategy attempt 3/'))
      ).toBe(true);
      expect(
        done.logs.some(
          (entry) =>
            (entry.message.includes('Simulated action click:') &&
              (entry.message.includes('만원') || entry.message.includes('원 이하') || entry.message.includes('가격대'))) ||
            /root-filter guard/i.test(entry.message) ||
            /stepwise-stage gate: filter stage is blocked/i.test(entry.message)
        )
      ).toBe(true);
      expect(
        done.logs.some(
          (entry) =>
            (entry.message.includes('Simulated action click:') &&
              (entry.message.includes('레드') || entry.message.includes('빨강') || entry.message.includes('색상'))) ||
            /root-filter guard/i.test(entry.message) ||
            /stepwise-stage gate: filter stage is blocked/i.test(entry.message)
        )
      ).toBe(true);
      const maxPathStepLogs = done.logs.filter((entry) => entry.message.includes('maxPathSteps='));
      expect(maxPathStepLogs.length).toBeGreaterThan(0);
      expect(
        maxPathStepLogs.some((entry) => /maxPathSteps=(6|7|8|9|10|11|12)/.test(entry.message))
      ).toBe(true);
    } finally {
      if (previousPlannerMode == null) {
        delete process.env.CHAT_AUTOMATION_PLANNER_MODE;
      } else {
        process.env.CHAT_AUTOMATION_PLANNER_MODE = previousPlannerMode;
      }
      await rm(root, { recursive: true, force: true });
    }
  });

  it('keeps hierarchy unresolved attempt from executing search/filter fallback in the same attempt', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'chat-automation-hierarchy-guard-'));
    const previousPlannerMode = process.env.CHAT_AUTOMATION_PLANNER_MODE;
    process.env.CHAT_AUTOMATION_PLANNER_MODE = 'rule_first';

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
        title: 'hierarchy guard',
        operatorId: 'op-hierarchy-guard'
      });

      await service.sendMessage({
        sessionId: created.session.id,
        content:
          'danawa.com 에 가서 여성스포츠의류 메뉴안에 등산복 중에서 10만원 이하의 등산복중에서 붉은색 옷을 찾아줘 하나만',
        browserMode: 'headful',
        operatorId: 'op-hierarchy-guard'
      });

      const done = await waitForSnapshot(
        service,
        created.session.id,
        (snapshot) => snapshot.run.status === 'completed'
      );

      expect(
        done.logs.some((entry) =>
          entry.message.includes('Hint dead-end guard activated') &&
          entry.message.includes('ending attempt early for hierarchy retry')
        )
      ).toBe(true);
      expect(
        done.logs.some((entry) => entry.message.includes('opening context gate for fallback actions'))
      ).toBe(false);
      expect(
        done.logs.some((entry) => entry.message.includes('Strict menu-first policy disabled for next attempts'))
      ).toBe(false);
      expect(
        done.logs.some(
          (entry) =>
            /skipped by filter-first gate/i.test(entry.message) ||
            /skipped by stepwise-stage gate: search stage blocked/i.test(entry.message)
        )
      ).toBe(true);

      const attempt1Start = done.logs.findIndex((entry) =>
        entry.message.includes('Listing strategy attempt 1/')
      );
      const attempt2Start = done.logs.findIndex((entry) =>
        entry.message.includes('Listing strategy attempt 2/')
      );
      expect(attempt1Start).toBeGreaterThanOrEqual(0);
      expect(attempt2Start).toBeGreaterThan(attempt1Start);
      const attempt1Logs = done.logs.slice(attempt1Start, attempt2Start).map((entry) => entry.message);
      expect(
        attempt1Logs.some(
          (message) =>
            /Planner action .*rule_fallback_search_probe/i.test(message) ||
            /Action type\(fallback-search-submit\)/i.test(message)
        )
      ).toBe(false);
    } finally {
      if (previousPlannerMode == null) {
        delete process.env.CHAT_AUTOMATION_PLANNER_MODE;
      } else {
        process.env.CHAT_AUTOMATION_PLANNER_MODE = previousPlannerMode;
      }
      await rm(root, { recursive: true, force: true });
    }
  });

  it('blocks search fallback until required budget/color filters are applied in strict menu-first flow', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'chat-automation-filter-coverage-gate-'));
    const previousPlannerMode = process.env.CHAT_AUTOMATION_PLANNER_MODE;
    process.env.CHAT_AUTOMATION_PLANNER_MODE = 'rule_first';

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
        title: 'filter coverage gate',
        operatorId: 'op-filter-coverage'
      });

      await service.sendMessage({
        sessionId: created.session.id,
        content:
          'danawa.com 에서 카테고리 메뉴를 열고 여성스포츠의류 > 등산복으로 이동한 뒤 10만원 이하 붉은색 상품 하나만 찾아줘',
        browserMode: 'headful',
        operatorId: 'op-filter-coverage'
      });

      const done = await waitForSnapshot(
        service,
        created.session.id,
        (snapshot) => snapshot.run.status === 'completed'
      );

      expect(
        done.logs.some(
          (entry) =>
            /skipped by filter-first gate/i.test(entry.message) ||
            /skipped by stepwise-stage gate: search stage blocked/i.test(entry.message)
        )
      ).toBe(true);
      expect(
        done.logs.some(
          (entry) =>
            /missing=budget,color/i.test(entry.message) ||
            /missing=category/i.test(entry.message) ||
            /root-filter guard/i.test(entry.message)
        )
      ).toBe(true);
    } finally {
      if (previousPlannerMode == null) {
        delete process.env.CHAT_AUTOMATION_PLANNER_MODE;
      } else {
        process.env.CHAT_AUTOMATION_PLANNER_MODE = previousPlannerMode;
      }
      await rm(root, { recursive: true, force: true });
    }
  });

  it('does not force menu-first strategy when user did not explicitly request category/menu traversal', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'chat-automation-strategy-bias-'));

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
        title: 'strategy bias check',
        operatorId: 'op-strategy'
      });

      await service.sendMessage({
        sessionId: created.session.id,
        content:
          'danawa.com 에 가서 여성스포츠의류 에서 등산복 중에서 10만원 이하의 붉은색 옷 하나만 찾아줘',
        browserMode: 'headful',
        operatorId: 'op-strategy'
      });

      const done = await waitForSnapshot(
        service,
        created.session.id,
        (snapshot) => snapshot.run.status === 'completed'
      );

      expect(
        done.logs.some(
          (entry) =>
            entry.message.includes('Task analysis:') &&
            entry.message.includes('strategy=menu_first')
        )
      ).toBe(false);
      expect(
        done.logs.some(
          (entry) =>
            entry.message.includes('Task analysis:') &&
            entry.message.includes('strategy=hybrid')
        )
      ).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('keeps menu-first strategy available when user explicitly asks category/menu traversal', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'chat-automation-strategy-menu-'));

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
        title: 'menu traversal request',
        operatorId: 'op-menu'
      });

      await service.sendMessage({
        sessionId: created.session.id,
        content:
          'danawa.com 에서 카테고리 메뉴를 열고 여성스포츠의류 > 등산복으로 이동해서 10만원 이하 붉은색 상품 하나만 찾아줘',
        browserMode: 'headful',
        operatorId: 'op-menu'
      });

      const done = await waitForSnapshot(
        service,
        created.session.id,
        (snapshot) => snapshot.run.status === 'completed'
      );

      expect(
        done.logs.some(
          (entry) =>
            entry.message.includes('Task analysis:') &&
            entry.message.includes('strategy=menu_first')
        )
      ).toBe(true);
      expect(
        done.logs.some(
          (entry) =>
            entry.message.includes('Hierarchy hint groups:') &&
            entry.message.includes('카테고리')
        )
      ).toBe(true);
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
      expect(waiting.handoffs.some((entry) => entry.type === 'captcha' && entry.status === 'waiting')).toBe(
        true
      );

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
      expect(done.handoffs.some((entry) => entry.type === 'captcha' && entry.status === 'resolved')).toBe(
        true
      );
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

  it('stores attachment metadata and enables attachment-aware steps', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'chat-automation-attachments-'));

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
        title: 'attachment session',
        operatorId: 'op-attach'
      });

      await service.sendMessage({
        sessionId: created.session.id,
        content: '첨부한 사진과 비슷한 것 네이버에서 찾아줘.',
        browserMode: 'headful',
        operatorId: 'op-attach',
        attachments: [
          {
            name: 'reference-shoe.png',
            mimeType: 'image/png',
            source: 'path',
            path: '/tmp/reference-shoe.png',
            sizeBytes: 1234
          }
        ]
      });

      const done = await waitForSnapshot(
        service,
        created.session.id,
        (snapshot) => snapshot.run.status === 'completed'
      );

      const userTurn = done.session.turns.find((turn) => turn.role === 'user');
      const metadata = userTurn?.metadata as
        | {
            attachments?: Array<{ name?: string; source?: string }>;
          }
        | undefined;

      expect(metadata?.attachments?.length).toBe(1);
      expect(metadata?.attachments?.[0]?.name).toBe('reference-shoe.png');
      expect(metadata?.attachments?.[0]?.source).toBe('path');
      expect(done.latestScreenshot?.source).toBe('attachment');
      expect(done.latestScreenshot?.path).toBe('/tmp/reference-shoe.png');
      expect(done.logs.some((entry) => entry.message.includes('Attachment-aware flow enabled'))).toBe(
        true
      );
      expect(
        done.logs.some((entry) =>
          entry.message.includes('Prepare image-based lookup flow with attached reference')
        )
      ).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('resolves waiting captcha handoff through generic resolve API and emits progress events', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'chat-automation-resolve-'));

    try {
      const store = new SessionStore({
        rootDir: root
      });
      const service = new ChatAutomationService({
        store,
        stepDelayMs: 15
      });
      await service.init();

      const progressEvents: Array<{ sessionId: string; runStatus: string }> = [];
      const unsubscribe = service.onProgress((event) => {
        progressEvents.push({
          sessionId: event.sessionId,
          runStatus: event.runStatus
        });
      });

      const created = await service.createSession({
        title: 'resolve handoff session',
        operatorId: 'op-resolve'
      });

      await service.sendMessage({
        sessionId: created.session.id,
        content: '로그인 과정에서 captcha 가 필요해.',
        browserMode: 'headful',
        operatorId: 'op-resolve'
      });

      const waiting = await waitForSnapshot(
        service,
        created.session.id,
        (snapshot) => snapshot.run.status === 'waiting_captcha'
      );

      const handoff = waiting.handoffs.find((entry) => entry.type === 'captcha' && entry.status === 'waiting');
      expect(handoff?.id).toBeTruthy();

      await service.resolveHandoff({
        sessionId: created.session.id,
        handoffId: handoff!.id,
        actionTaken: 'submit_captcha',
        value: 'QWER12',
        resolvedBy: 'human-operator'
      });

      const done = await waitForSnapshot(
        service,
        created.session.id,
        (snapshot) => snapshot.run.status === 'completed'
      );

      for (let index = 0; index < 50; index += 1) {
        if (progressEvents.some((entry) => entry.runStatus === 'completed')) {
          break;
        }
        await sleep(10);
      }
      unsubscribe();

      expect(done.handoffs.some((entry) => entry.id === handoff!.id && entry.status === 'resolved')).toBe(
        true
      );
      expect(done.logs.some((entry) => entry.message.includes('Handoff resolved by human-operator'))).toBe(
        true
      );
      expect(progressEvents.some((entry) => entry.sessionId === created.session.id)).toBe(true);
      expect(progressEvents.some((entry) => entry.runStatus === 'waiting_captcha')).toBe(true);
      expect(progressEvents.some((entry) => entry.runStatus === 'completed')).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('does not open category-context gate from weak expansion-only logs', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'chat-automation-signal-'));

    try {
      const store = new SessionStore({
        rootDir: root
      });
      const service = new ChatAutomationService({
        store,
        stepDelayMs: 15
      });
      await service.init();

      const signal = (service as unknown as {
        logDriverMessages: (
          state: {
            logs: Array<{ level: string; message: string }>;
            run: { updatedAt: string };
          },
          messages: Array<{ level: 'info' | 'warn' | 'error'; message: string }>
        ) => {
          hintNavigateSuccess: number;
        };
      }).logDriverMessages(
        {
          logs: [],
          run: { updatedAt: '' }
        },
        [
          {
            level: 'info',
            message: 'Hint navigation weak expansion accepted: text=전체 카테고리 nextHints=[여성스포츠의류]'
          }
        ]
      );

      expect(signal.hintNavigateSuccess).toBe(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('classifies mixed warn+success step logs as success screenshot when warnings are non-terminal', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'chat-automation-screenshot-classify-'));

    try {
      const store = new SessionStore({
        rootDir: root
      });
      const service = new ChatAutomationService({
        store,
        stepDelayMs: 15
      });
      await service.init();

      const reason = (
        service as unknown as {
          classifyStepScreenshotReason: (
            step: { kind: string },
            stepLogs: Array<{ level: 'info' | 'warn' | 'error'; message: string }>
          ) => 'success' | 'issue' | undefined;
        }
      ).classifyStepScreenshotReason(
        { kind: 'listing' },
        [
          {
            level: 'warn',
            message: 'Action click(category) skipped: no matching candidate'
          },
          {
            level: 'info',
            message: 'Hint navigation "여성스포츠의류" via click: text=여성스포츠의류 href=https://example.com'
          }
        ]
      );

      expect(reason).toBe('success');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('classifies terminal failure signals as issue screenshot even with prior success logs', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'chat-automation-screenshot-issue-'));

    try {
      const store = new SessionStore({
        rootDir: root
      });
      const service = new ChatAutomationService({
        store,
        stepDelayMs: 15
      });
      await service.init();

      const reason = (
        service as unknown as {
          classifyStepScreenshotReason: (
            step: { kind: string },
            stepLogs: Array<{ level: 'info' | 'warn' | 'error'; message: string }>
          ) => 'success' | 'issue' | undefined;
        }
      ).classifyStepScreenshotReason(
        { kind: 'listing' },
        [
          {
            level: 'info',
            message: 'Hint navigation hop 2/3: expected=등산복 matched=등산복'
          },
          {
            level: 'warn',
            message: 'Listing result remained low-confidence after all strategy attempts'
          }
        ]
      );

      expect(reason).toBe('issue');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
