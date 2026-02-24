import { EventEmitter } from 'node:events';

import type { GenerateTurnOutput, MultiTurnEngine } from '../session/engine';
import { buildDefaultTurnEngine } from '../session/engine';
import { SessionStore } from '../session/store';
import type {
  AddSessionTurnInput,
  AutomationSession,
  CreateSessionInput,
  SessionTurn
} from '../session/types';

export interface SendUserTurnInput {
  sessionId: string;
  content: string;
  screenshotPath?: string;
  metadata?: Record<string, unknown>;
}

export interface SendUserTurnOutput {
  session: AutomationSession;
  userTurn: SessionTurn;
  assistantTurn: SessionTurn;
}

export interface BackendSimpleServiceOptions {
  store: SessionStore;
  engine?: MultiTurnEngine;
}

export type SessionUpdateListener = (session: AutomationSession) => void;

function requireNonEmpty(value: string, name: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error(`${name} must not be empty`);
  }
  return trimmed;
}

function lastTurn(session: AutomationSession): SessionTurn {
  const turn = session.turns[session.turns.length - 1];
  if (!turn) {
    throw new Error(`session has no turns: ${session.id}`);
  }
  return turn;
}

export class BackendSimpleService {
  private readonly store: SessionStore;
  private readonly engine: MultiTurnEngine;
  private readonly emitter = new EventEmitter();

  constructor(options: BackendSimpleServiceOptions) {
    this.store = options.store;
    this.engine = options.engine ?? buildDefaultTurnEngine();
  }

  private updateEvent(sessionId: string): string {
    return `session:${sessionId}`;
  }

  private emitSession(session: AutomationSession): void {
    this.emitter.emit(this.updateEvent(session.id), session);
  }

  onSessionUpdate(sessionId: string, listener: SessionUpdateListener): () => void {
    const event = this.updateEvent(sessionId);
    this.emitter.on(event, listener);
    return () => {
      this.emitter.off(event, listener);
    };
  }

  async createSession(input: CreateSessionInput = {}): Promise<AutomationSession> {
    const created = await this.store.create(input);
    this.emitSession(created);
    return created;
  }

  async listSessions(): Promise<AutomationSession[]> {
    return this.store.list();
  }

  async getSession(sessionId: string): Promise<AutomationSession> {
    const session = await this.store.get(sessionId);
    if (!session) {
      throw new Error(`session not found: ${sessionId}`);
    }
    return session;
  }

  async closeSession(sessionId: string): Promise<AutomationSession> {
    const closed = await this.store.close(sessionId);
    this.emitSession(closed);
    return closed;
  }

  private async appendTurn(
    sessionId: string,
    input: AddSessionTurnInput
  ): Promise<{ session: AutomationSession; turn: SessionTurn }> {
    const session = await this.store.appendTurn(sessionId, input);
    const turn = lastTurn(session);
    this.emitSession(session);
    return {
      session,
      turn
    };
  }

  private async generateAssistantTurn(input: {
    session: AutomationSession;
    userMessage: string;
  }): Promise<GenerateTurnOutput> {
    return this.engine.generate({
      session: input.session,
      userMessage: input.userMessage
    });
  }

  async sendUserTurn(input: SendUserTurnInput): Promise<SendUserTurnOutput> {
    const content = requireNonEmpty(input.content, 'content');

    const userAppend = await this.appendTurn(input.sessionId, {
      role: 'user',
      content,
      screenshotPath: input.screenshotPath,
      metadata: input.metadata
    });

    const assistant = await this.generateAssistantTurn({
      session: userAppend.session,
      userMessage: content
    });

    const assistantAppend = await this.appendTurn(input.sessionId, {
      role: 'assistant',
      content: assistant.content,
      metadata: assistant.metadata
    });

    return {
      session: assistantAppend.session,
      userTurn: userAppend.turn,
      assistantTurn: assistantAppend.turn
    };
  }
}
