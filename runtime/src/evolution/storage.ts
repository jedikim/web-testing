import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import type {
  ActiveVersionPointer,
  CreateEvolutionJobInput,
  EvolutionEvent,
  EvolutionJob,
  EvolutionModelPolicy
} from './types';

export interface EvolutionStorageOptions {
  rootDir: string;
  now?: () => Date;
  idGenerator?: () => string;
}

interface CreateJobPersistInput {
  request: CreateEvolutionJobInput;
  modelPolicy: EvolutionModelPolicy;
  baseBranch: string;
  testCommand: string;
  maxAutoFixAttempts: number;
}

function sanitizeName(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9._-]/g, '-');
}

function toJson<T>(value: T): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function fallbackId(now: Date): string {
  const stamp = now.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  const entropy = Math.random().toString(36).slice(2, 8);
  return `evo-${stamp}-${entropy}`;
}

async function readJsonFile<T>(path: string): Promise<T | undefined> {
  try {
    const raw = await readFile(path, 'utf-8');
    return JSON.parse(raw) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
}

async function ensureParent(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
}

export class EvolutionStorage {
  private readonly rootDir: string;
  private readonly now: () => Date;
  private readonly idGenerator: () => string;

  constructor(options: EvolutionStorageOptions) {
    this.rootDir = resolve(options.rootDir);
    this.now = options.now ?? (() => new Date());
    this.idGenerator = options.idGenerator ?? (() => fallbackId(this.now()));
  }

  async init(): Promise<void> {
    await mkdir(this.jobsRoot(), { recursive: true });
    await mkdir(this.activeVersionsRoot(), { recursive: true });
    await mkdir(this.historyRoot(), { recursive: true });
  }

  root(): string {
    return this.rootDir;
  }

  jobsRoot(): string {
    return resolve(this.rootDir, 'jobs');
  }

  activeVersionsRoot(): string {
    return resolve(this.rootDir, 'active-versions');
  }

  historyRoot(): string {
    return resolve(this.rootDir, 'version-history');
  }

  jobDir(jobId: string): string {
    return resolve(this.jobsRoot(), sanitizeName(jobId));
  }

  jobFile(jobId: string): string {
    return resolve(this.jobDir(jobId), 'job.json');
  }

  eventsFile(jobId: string): string {
    return resolve(this.jobDir(jobId), 'events.json');
  }

  attemptsDir(jobId: string): string {
    return resolve(this.jobDir(jobId), 'attempts');
  }

  scenarioPackDir(jobId: string): string {
    return resolve(this.jobDir(jobId), 'scenario-pack');
  }

  attemptOutputPath(jobId: string, attempt: number): string {
    return resolve(this.attemptsDir(jobId), `attempt-${String(attempt).padStart(3, '0')}.log`);
  }

  attemptAutoFixNotePath(jobId: string, attempt: number): string {
    return resolve(this.attemptsDir(jobId), `attempt-${String(attempt).padStart(3, '0')}-autofix.md`);
  }

  activeVersionPath(workflowId: string): string {
    return resolve(this.activeVersionsRoot(), `${sanitizeName(workflowId)}.json`);
  }

  historyPath(workflowId: string): string {
    return resolve(this.historyRoot(), `${sanitizeName(workflowId)}.json`);
  }

  async createJob(input: CreateJobPersistInput): Promise<EvolutionJob> {
    await this.init();
    const now = this.now().toISOString();
    const jobId = this.idGenerator();

    const created: EvolutionJob = {
      id: jobId,
      title: input.request.title,
      trigger: input.request.trigger,
      workflowId: input.request.workflowId,
      sourceRunPath: input.request.sourceRunPath,
      notes: input.request.notes,
      status: 'draft',
      requestedBy: input.request.requestedBy ?? 'system',
      createdAt: now,
      updatedAt: now,
      modelPolicy: input.modelPolicy,
      baseBranch: input.baseBranch,
      testCommand: input.testCommand,
      maxAutoFixAttempts: input.maxAutoFixAttempts,
      currentVersion: 0,
      changelog: [
        {
          at: now,
          category: 'ops',
          summary: 'Evolution job created'
        }
      ]
    };

    await this.saveJob(created);
    await this.saveEvents(jobId, [
      {
        at: now,
        stage: 'created',
        message: 'Evolution job accepted and queued'
      }
    ]);
    return created;
  }

  async listJobs(): Promise<EvolutionJob[]> {
    await this.init();
    const dirs = await readdir(this.jobsRoot(), { withFileTypes: true });
    const jobs: EvolutionJob[] = [];

    for (const entry of dirs) {
      if (!entry.isDirectory()) {
        continue;
      }
      const path = resolve(this.jobsRoot(), entry.name, 'job.json');
      const job = await readJsonFile<EvolutionJob>(path);
      if (job) {
        jobs.push(job);
      }
    }

    return jobs.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async getJob(jobId: string): Promise<EvolutionJob | undefined> {
    return readJsonFile<EvolutionJob>(this.jobFile(jobId));
  }

  async saveJob(job: EvolutionJob): Promise<void> {
    const path = this.jobFile(job.id);
    await ensureParent(path);
    await writeFile(path, toJson(job), 'utf-8');
  }

  async listEvents(jobId: string): Promise<EvolutionEvent[]> {
    const events = await readJsonFile<EvolutionEvent[]>(this.eventsFile(jobId));
    return events ?? [];
  }

  async saveEvents(jobId: string, events: EvolutionEvent[]): Promise<void> {
    const path = this.eventsFile(jobId);
    await ensureParent(path);
    await writeFile(path, toJson(events), 'utf-8');
  }

  async appendEvent(jobId: string, event: EvolutionEvent): Promise<void> {
    const events = await this.listEvents(jobId);
    events.push(event);
    await this.saveEvents(jobId, events);
  }

  async setActiveVersion(pointer: ActiveVersionPointer): Promise<void> {
    const path = this.activeVersionPath(pointer.workflowId);
    await ensureParent(path);
    await writeFile(path, toJson(pointer), 'utf-8');

    const historyPath = this.historyPath(pointer.workflowId);
    const history = (await readJsonFile<ActiveVersionPointer[]>(historyPath)) ?? [];
    history.push(pointer);
    await ensureParent(historyPath);
    await writeFile(historyPath, toJson(history), 'utf-8');
  }

  async getActiveVersion(workflowId: string): Promise<ActiveVersionPointer | undefined> {
    return readJsonFile<ActiveVersionPointer>(this.activeVersionPath(workflowId));
  }
}
