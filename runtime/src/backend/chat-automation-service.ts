import { EventEmitter } from 'node:events';

import { SessionStore } from '../session/store';
import type { AddSessionTurnInput, AutomationSession, CreateSessionInput, SessionTurn } from '../session/types';

export type BrowserMode = 'headful' | 'headless';

export type ChatAutomationRunStatus =
  | 'idle'
  | 'running'
  | 'paused'
  | 'waiting_captcha'
  | 'completed'
  | 'failed'
  | 'canceled';

export type ChatAutomationLogLevel = 'info' | 'warn' | 'error';

export interface ChatAutomationLogEntry {
  id: string;
  at: string;
  level: ChatAutomationLogLevel;
  message: string;
}

export interface ChatAutomationTask {
  id: string;
  content: string;
  browserMode: BrowserMode;
  requestedAt: string;
}

export interface ChatAutomationRunState {
  runId?: string;
  status: ChatAutomationRunStatus;
  browserMode?: BrowserMode;
  step: number;
  totalSteps: number;
  currentStepTitle?: string;
  startedAt?: string;
  updatedAt: string;
  lastMessage?: string;
  lastError?: string;
  waitingCaptcha: boolean;
  captchaPrompt?: string;
  queueLength: number;
}

export interface ChatAutomationSessionSnapshot {
  session: AutomationSession;
  run: ChatAutomationRunState;
  logs: ChatAutomationLogEntry[];
}

export interface ChatAutomationSessionSummary {
  sessionId: string;
  title?: string;
  operatorId: string;
  runStatus: ChatAutomationRunStatus;
  browserMode?: BrowserMode;
  updatedAt: string;
  queueLength: number;
}

export interface SendMessageInput {
  sessionId: string;
  content: string;
  browserMode: BrowserMode;
  operatorId?: string;
  autoPauseOthers?: boolean;
}

export interface CreateChatSessionInput {
  title?: string;
  workflowId?: string;
  tags?: string[];
  operatorId?: string;
  metadata?: Record<string, unknown>;
  systemPrompt?: string;
}

export interface SubmitCaptchaInput {
  sessionId: string;
  value: string;
}

export interface ChatAutomationServiceOptions {
  store: SessionStore;
  stepDelayMs?: number;
  logTailSize?: number;
}

interface SessionRuntimeState {
  sessionId: string;
  operatorId: string;
  run: ChatAutomationRunState;
  queue: ChatAutomationTask[];
  logs: ChatAutomationLogEntry[];
  workerRunning: boolean;
  paused: boolean;
  canceled: boolean;
  pendingCaptchaValue?: string;
}

interface RuntimeStep {
  kind: 'analysis' | 'browser' | 'navigate' | 'captcha' | 'listing' | 'verify';
  title: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function ensureNonEmpty(value: string, name: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error(`${name} must not be empty`);
  }
  return trimmed;
}

function nowIso(): string {
  return new Date().toISOString();
}

function buildRunState(now: string): ChatAutomationRunState {
  return {
    status: 'idle',
    step: 0,
    totalSteps: 0,
    updatedAt: now,
    waitingCaptcha: false,
    queueLength: 0
  };
}

function detectSiteFromMessage(message: string): string {
  const urlMatch = message.match(/https?:\/\/[^\s)]+/i);
  if (urlMatch) {
    return urlMatch[0]!;
  }

  if (/naver/i.test(message)) {
    return 'https://www.naver.com';
  }

  if (/google/i.test(message)) {
    return 'https://www.google.com';
  }

  return 'https://example.com';
}

function needsCaptchaInput(message: string): boolean {
  return /(captcha|로그인|인증|verification|otp|2fa)/i.test(message);
}

function buildStepPlan(message: string): RuntimeStep[] {
  const steps: RuntimeStep[] = [
    { kind: 'analysis', title: 'Analyze user objective and extract constraints' },
    { kind: 'browser', title: 'Prepare browser runtime and execution mode' },
    { kind: 'navigate', title: `Navigate target site ${detectSiteFromMessage(message)}` },
    { kind: 'listing', title: 'Inspect listing/repeated items and select candidate actions' },
    { kind: 'verify', title: 'Verify outcome and prepare next turn summary' }
  ];

  if (needsCaptchaInput(message)) {
    steps.splice(3, 0, {
      kind: 'captcha',
      title: 'Captcha / security challenge requires user input'
    });
  }

  return steps;
}

function asCreateSessionInput(input: CreateChatSessionInput): CreateSessionInput {
  return {
    mode: 'backend_simple',
    title: input.title,
    workflowId: input.workflowId,
    tags: input.tags,
    metadata: {
      ...(input.metadata ?? {}),
      operatorId: input.operatorId ?? 'default-operator'
    },
    systemPrompt: input.systemPrompt
  };
}

export type ChatAutomationSessionUpdateListener = (
  snapshot: ChatAutomationSessionSnapshot
) => void;

export class ChatAutomationService {
  private readonly store: SessionStore;
  private readonly stepDelayMs: number;
  private readonly logTailSize: number;
  private readonly emitter = new EventEmitter();
  private readonly runtime = new Map<string, SessionRuntimeState>();

  constructor(options: ChatAutomationServiceOptions) {
    this.store = options.store;
    this.stepDelayMs = Math.max(1, Math.floor(options.stepDelayMs ?? 450));
    this.logTailSize = Math.max(20, Math.floor(options.logTailSize ?? 300));
  }

  async init(): Promise<void> {
    const sessions = await this.store.list();

    for (const session of sessions) {
      const operatorId = String(session.metadata?.operatorId ?? 'default-operator');
      this.runtime.set(session.id, {
        sessionId: session.id,
        operatorId,
        run: buildRunState(nowIso()),
        queue: [],
        logs: [],
        workerRunning: false,
        paused: false,
        canceled: false
      });
    }
  }

  private stateEvent(sessionId: string): string {
    return `session:${sessionId}`;
  }

  private ensureRuntime(session: AutomationSession): SessionRuntimeState {
    const current = this.runtime.get(session.id);
    if (current) {
      return current;
    }

    const created: SessionRuntimeState = {
      sessionId: session.id,
      operatorId: String(session.metadata?.operatorId ?? 'default-operator'),
      run: buildRunState(nowIso()),
      queue: [],
      logs: [],
      workerRunning: false,
      paused: false,
      canceled: false
    };
    this.runtime.set(session.id, created);
    return created;
  }

  private async mustGetSession(sessionId: string): Promise<AutomationSession> {
    const session = await this.store.get(sessionId);
    if (!session) {
      throw new Error(`session not found: ${sessionId}`);
    }
    return session;
  }

  private tailLogs(logs: ChatAutomationLogEntry[]): ChatAutomationLogEntry[] {
    return logs.slice(Math.max(0, logs.length - this.logTailSize));
  }

  private log(state: SessionRuntimeState, level: ChatAutomationLogLevel, message: string): void {
    const entry: ChatAutomationLogEntry = {
      id: `${state.sessionId}-log-${state.logs.length + 1}`,
      at: nowIso(),
      level,
      message
    };

    state.logs.push(entry);
    state.logs = this.tailLogs(state.logs);
    state.run.updatedAt = entry.at;
  }

  private async appendTurn(
    sessionId: string,
    input: AddSessionTurnInput
  ): Promise<{ session: AutomationSession; turn: SessionTurn }> {
    const session = await this.store.appendTurn(sessionId, input);
    const turn = session.turns[session.turns.length - 1];
    if (!turn) {
      throw new Error(`session has no turn: ${sessionId}`);
    }

    return {
      session,
      turn
    };
  }

  private async emitSnapshot(sessionId: string): Promise<void> {
    const snapshot = await this.getSnapshot(sessionId);
    this.emitter.emit(this.stateEvent(sessionId), snapshot);
  }

  onSessionUpdate(sessionId: string, listener: ChatAutomationSessionUpdateListener): () => void {
    const event = this.stateEvent(sessionId);
    this.emitter.on(event, listener);
    return () => {
      this.emitter.off(event, listener);
    };
  }

  async createSession(input: CreateChatSessionInput = {}): Promise<ChatAutomationSessionSnapshot> {
    const created = await this.store.create(asCreateSessionInput(input));
    const state = this.ensureRuntime(created);
    state.operatorId = input.operatorId ?? state.operatorId;
    state.run.updatedAt = nowIso();

    this.log(state, 'info', 'Session created');
    await this.emitSnapshot(created.id);
    return this.getSnapshot(created.id);
  }

  async listSessions(): Promise<ChatAutomationSessionSummary[]> {
    const sessions = await this.store.list();

    return sessions
      .map((session) => {
        const state = this.ensureRuntime(session);
        return {
          sessionId: session.id,
          title: session.title,
          operatorId: state.operatorId,
          runStatus: state.run.status,
          browserMode: state.run.browserMode,
          updatedAt:
            state.run.updatedAt.localeCompare(session.updatedAt) > 0
              ? state.run.updatedAt
              : session.updatedAt,
          queueLength: state.queue.length
        } satisfies ChatAutomationSessionSummary;
      })
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async getSnapshot(sessionId: string): Promise<ChatAutomationSessionSnapshot> {
    const session = await this.mustGetSession(sessionId);
    const state = this.ensureRuntime(session);
    state.run.queueLength = state.queue.length;

    return {
      session,
      run: {
        ...state.run,
        queueLength: state.queue.length
      },
      logs: [...state.logs]
    };
  }

  private async pauseOtherSessions(operatorId: string, exceptSessionId: string): Promise<void> {
    for (const state of this.runtime.values()) {
      if (state.operatorId !== operatorId || state.sessionId === exceptSessionId) {
        continue;
      }

      if (state.run.status === 'running' || state.run.status === 'waiting_captcha') {
        state.paused = true;
        state.run.status = 'paused';
        this.log(state, 'warn', `Paused because operator switched to session ${exceptSessionId}`);
        await this.emitSnapshot(state.sessionId);
      }
    }
  }

  private async waitWhilePaused(state: SessionRuntimeState): Promise<void> {
    while (state.paused) {
      if (state.canceled) {
        return;
      }
      await sleep(120);
    }
  }

  private async executeStep(
    sessionId: string,
    state: SessionRuntimeState,
    step: RuntimeStep,
    task: ChatAutomationTask,
    stepIndex: number,
    totalSteps: number
  ): Promise<void> {
    await this.waitWhilePaused(state);
    if (state.canceled || state.run.runId !== task.id) {
      throw new Error('run canceled');
    }

    state.run.step = stepIndex + 1;
    state.run.totalSteps = totalSteps;
    state.run.currentStepTitle = step.title;
    state.run.updatedAt = nowIso();

    this.log(state, 'info', `Step ${stepIndex + 1}/${totalSteps}: ${step.title}`);
    await this.emitSnapshot(sessionId);

    if (step.kind === 'captcha') {
      state.run.status = state.paused ? 'paused' : 'waiting_captcha';
      state.run.waitingCaptcha = true;
      state.run.captchaPrompt = 'Security challenge detected. Enter captcha value to continue.';
      this.log(state, 'warn', 'Captcha input required from user');
      await this.appendTurn(sessionId, {
        role: 'assistant',
        content:
          'Captcha/security challenge detected. Please enter captcha in UI to continue safely.'
      });
      await this.emitSnapshot(sessionId);

      while (!state.pendingCaptchaValue) {
        if (state.canceled || state.run.runId !== task.id) {
          throw new Error('run canceled');
        }

        if (state.paused) {
          state.run.status = 'paused';
        } else {
          state.run.status = 'waiting_captcha';
        }

        await sleep(150);
      }

      const submitted = state.pendingCaptchaValue;
      state.pendingCaptchaValue = undefined;
      state.run.waitingCaptcha = false;
      state.run.captchaPrompt = undefined;
      state.run.status = state.paused ? 'paused' : 'running';
      this.log(state, 'info', `Captcha accepted (length=${submitted.length})`);
      await this.appendTurn(sessionId, {
        role: 'assistant',
        content: 'Captcha value received. Continuing automation.'
      });
      await this.emitSnapshot(sessionId);
      await sleep(this.stepDelayMs);
      return;
    }

    await sleep(this.stepDelayMs);
  }

  private async runTask(sessionId: string, state: SessionRuntimeState, task: ChatAutomationTask): Promise<void> {
    state.canceled = false;
    state.run.runId = task.id;
    state.run.status = state.paused ? 'paused' : 'running';
    state.run.browserMode = task.browserMode;
    state.run.startedAt = nowIso();
    state.run.updatedAt = state.run.startedAt;
    state.run.lastMessage = task.content;
    state.run.lastError = undefined;
    state.run.step = 0;
    state.run.totalSteps = 0;
    state.run.currentStepTitle = undefined;
    state.run.waitingCaptcha = false;
    state.run.captchaPrompt = undefined;

    const steps = buildStepPlan(task.content);
    this.log(
      state,
      'info',
      `Run started (${task.browserMode}) with ${steps.length} steps; target=${detectSiteFromMessage(task.content)}`
    );
    await this.appendTurn(sessionId, {
      role: 'assistant',
      content: `Automation started in ${task.browserMode} mode.`
    });
    await this.emitSnapshot(sessionId);

    for (let index = 0; index < steps.length; index += 1) {
      if (state.canceled || state.run.runId !== task.id) {
        throw new Error('run canceled');
      }
      await this.executeStep(sessionId, state, steps[index]!, task, index, steps.length);
    }

    state.run.status = 'completed';
    state.run.updatedAt = nowIso();
    state.run.currentStepTitle = 'Completed';
    this.log(state, 'info', 'Run completed successfully');
    await this.appendTurn(sessionId, {
      role: 'assistant',
      content: 'Automation run completed. You can continue with next request or open another session.'
    });
    await this.emitSnapshot(sessionId);
  }

  private async startWorkerIfNeeded(sessionId: string): Promise<void> {
    const session = await this.mustGetSession(sessionId);
    const state = this.ensureRuntime(session);

    if (state.workerRunning) {
      return;
    }

    state.workerRunning = true;

    void (async () => {
      try {
        while (state.queue.length > 0) {
          await this.waitWhilePaused(state);
          const task = state.queue.shift();
          if (!task) {
            continue;
          }

          try {
            await this.runTask(sessionId, state, task);
          } catch (error) {
            if ((error as Error).message === 'run canceled') {
              state.run.status = 'canceled';
              state.run.updatedAt = nowIso();
              this.log(state, 'warn', 'Run canceled');
              await this.emitSnapshot(sessionId);
              continue;
            }

            state.run.status = 'failed';
            state.run.lastError = (error as Error).message;
            state.run.updatedAt = nowIso();
            this.log(state, 'error', `Run failed: ${(error as Error).message}`);
            await this.appendTurn(sessionId, {
              role: 'assistant',
              content: `Run failed: ${(error as Error).message}`
            });
            await this.emitSnapshot(sessionId);
          }
        }
      } finally {
        state.workerRunning = false;
        state.run.queueLength = state.queue.length;
      }
    })();
  }

  async sendMessage(input: SendMessageInput): Promise<ChatAutomationSessionSnapshot> {
    const content = ensureNonEmpty(input.content, 'content');

    const session = await this.mustGetSession(input.sessionId);
    const state = this.ensureRuntime(session);

    if (input.operatorId) {
      state.operatorId = input.operatorId;
    }

    await this.appendTurn(input.sessionId, {
      role: 'user',
      content
    });

    const now = nowIso();
    state.queue.push({
      id: `${input.sessionId}-run-${now.replace(/[-:.TZ]/g, '')}-${state.queue.length + 1}`,
      content,
      browserMode: input.browserMode,
      requestedAt: now
    });
    state.run.queueLength = state.queue.length;

    this.log(state, 'info', `User message queued (${input.browserMode})`);

    if (input.autoPauseOthers ?? true) {
      await this.pauseOtherSessions(state.operatorId, input.sessionId);
    }

    state.paused = false;
    await this.emitSnapshot(input.sessionId);
    await this.startWorkerIfNeeded(input.sessionId);

    return this.getSnapshot(input.sessionId);
  }

  async pauseSession(sessionId: string): Promise<ChatAutomationSessionSnapshot> {
    const session = await this.mustGetSession(sessionId);
    const state = this.ensureRuntime(session);
    state.paused = true;

    if (state.run.status === 'running' || state.run.status === 'waiting_captcha') {
      state.run.status = 'paused';
      state.run.updatedAt = nowIso();
    }

    this.log(state, 'warn', 'Session paused by user');
    await this.emitSnapshot(sessionId);
    return this.getSnapshot(sessionId);
  }

  async resumeSession(sessionId: string): Promise<ChatAutomationSessionSnapshot> {
    const session = await this.mustGetSession(sessionId);
    const state = this.ensureRuntime(session);
    state.paused = false;

    if (state.run.waitingCaptcha) {
      state.run.status = 'waiting_captcha';
    } else if (state.run.status === 'paused') {
      state.run.status = state.workerRunning ? 'running' : state.run.status;
    }

    state.run.updatedAt = nowIso();
    this.log(state, 'info', 'Session resumed by user');
    await this.emitSnapshot(sessionId);
    await this.startWorkerIfNeeded(sessionId);
    return this.getSnapshot(sessionId);
  }

  async cancelSession(sessionId: string): Promise<ChatAutomationSessionSnapshot> {
    const session = await this.mustGetSession(sessionId);
    const state = this.ensureRuntime(session);
    state.canceled = true;
    state.queue = [];
    state.run.queueLength = 0;
    state.pendingCaptchaValue = undefined;
    state.run.waitingCaptcha = false;
    state.run.captchaPrompt = undefined;
    state.run.status = 'canceled';
    state.run.updatedAt = nowIso();
    this.log(state, 'warn', 'Session canceled by user');
    await this.emitSnapshot(sessionId);
    return this.getSnapshot(sessionId);
  }

  async submitCaptcha(input: SubmitCaptchaInput): Promise<ChatAutomationSessionSnapshot> {
    const value = ensureNonEmpty(input.value, 'captcha value');
    const session = await this.mustGetSession(input.sessionId);
    const state = this.ensureRuntime(session);

    state.pendingCaptchaValue = value;
    state.run.updatedAt = nowIso();
    this.log(state, 'info', `Captcha submitted by user (length=${value.length})`);
    await this.emitSnapshot(input.sessionId);
    return this.getSnapshot(input.sessionId);
  }
}
