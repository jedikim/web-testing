import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import type {
  AddSessionTurnInput,
  AutomationSession,
  CreateSessionInput,
  SessionTurn
} from './types';

export interface SessionStoreOptions {
  rootDir: string;
  now?: () => Date;
  idGenerator?: () => string;
}

function toJson<T>(value: T): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function safeName(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9._-]/g, '-');
}

function defaultId(now: Date): string {
  const stamp = now.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  const entropy = Math.random().toString(36).slice(2, 8);
  return `sess-${stamp}-${entropy}`;
}

async function readJsonFile<T>(path: string): Promise<T | undefined> {
  const maxRetries = 3;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const raw = await readFile(path, 'utf-8');
      return JSON.parse(raw) as T;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return undefined;
      }
      if (error instanceof SyntaxError && attempt < maxRetries) {
        await new Promise((resolvePromise) => {
          setTimeout(resolvePromise, 10 * (attempt + 1));
        });
        continue;
      }
      throw error;
    }
  }

  return undefined;
}

export class SessionStore {
  private readonly rootDir: string;
  private readonly now: () => Date;
  private readonly idGenerator: () => string;

  constructor(options: SessionStoreOptions) {
    this.rootDir = resolve(options.rootDir);
    this.now = options.now ?? (() => new Date());
    this.idGenerator = options.idGenerator ?? (() => defaultId(this.now()));
  }

  root(): string {
    return this.rootDir;
  }

  sessionsRoot(): string {
    return resolve(this.rootDir, 'sessions');
  }

  sessionPath(sessionId: string): string {
    return resolve(this.sessionsRoot(), `${safeName(sessionId)}.json`);
  }

  private async ensure(): Promise<void> {
    await mkdir(this.sessionsRoot(), { recursive: true });
  }

  private async save(session: AutomationSession): Promise<void> {
    const path = this.sessionPath(session.id);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, toJson(session), 'utf-8');
  }

  async create(input: CreateSessionInput): Promise<AutomationSession> {
    await this.ensure();

    const now = this.now().toISOString();
    const id = this.idGenerator();

    const turns: SessionTurn[] = [];
    if (input.systemPrompt) {
      turns.push({
        id: `${id}-turn-1`,
        role: 'system',
        content: input.systemPrompt,
        at: now
      });
    }

    const session: AutomationSession = {
      id,
      mode: input.mode ?? 'backend_simple',
      status: 'active',
      workflowId: input.workflowId,
      title: input.title,
      createdAt: now,
      updatedAt: now,
      turns,
      tags: input.tags,
      metadata: input.metadata
    };

    await this.save(session);
    return session;
  }

  async get(sessionId: string): Promise<AutomationSession | undefined> {
    return readJsonFile<AutomationSession>(this.sessionPath(sessionId));
  }

  async list(): Promise<AutomationSession[]> {
    await this.ensure();
    const entries = await readdir(this.sessionsRoot(), { withFileTypes: true });
    const sessions: AutomationSession[] = [];

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) {
        continue;
      }

      const session = await readJsonFile<AutomationSession>(resolve(this.sessionsRoot(), entry.name));
      if (session) {
        sessions.push(session);
      }
    }

    return sessions.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async appendTurn(sessionId: string, input: AddSessionTurnInput): Promise<AutomationSession> {
    const session = await this.get(sessionId);
    if (!session) {
      throw new Error(`session not found: ${sessionId}`);
    }

    if (session.status !== 'active') {
      throw new Error(`session is not active: ${sessionId}`);
    }

    const at = this.now().toISOString();
    const turnId = `${session.id}-turn-${session.turns.length + 1}`;

    session.turns.push({
      id: turnId,
      role: input.role,
      content: input.content,
      at,
      screenshotPath: input.screenshotPath,
      metadata: input.metadata
    });
    session.updatedAt = at;

    await this.save(session);
    return session;
  }

  async close(sessionId: string): Promise<AutomationSession> {
    const session = await this.get(sessionId);
    if (!session) {
      throw new Error(`session not found: ${sessionId}`);
    }

    session.status = 'closed';
    session.updatedAt = this.now().toISOString();
    await this.save(session);
    return session;
  }
}
