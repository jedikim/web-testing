import { EventEmitter } from 'node:events';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  GeminiPatchAutoFixer,
  NoopAutoFixer,
  type AutoFixApplyResult,
  type EvolutionAutoFixer
} from './gemini-autofix';
import { GitWorktreeSandbox, type EvolutionSandbox } from './git-sandbox';
import { resolveEvolutionModelPolicy } from './model-policy';
import { buildScenarioPack } from './scenario-growth';
import { EvolutionStorage } from './storage';
import type {
  ActiveVersionPointer,
  ApproveEvolutionJobInput,
  CreateEvolutionJobInput,
  EvolutionChangeCategory,
  EvolutionJobDiffSnapshot,
  EvolutionEvent,
  EvolutionJob,
  EvolutionVersionSummary,
  JobProgressSnapshot,
  RejectEvolutionJobInput
} from './types';

export interface EvolutionServiceOptions {
  repoRoot: string;
  stateRoot: string;
  baseBranch?: string;
  defaultTestCommand?: string;
  maxAutoFixAttempts?: number;
  testTimeoutMs?: number;
  testEnv?: NodeJS.ProcessEnv;
  autoStart?: boolean;
  storage?: EvolutionStorage;
  sandbox?: EvolutionSandbox;
  autoFixer?: EvolutionAutoFixer;
}

export type EvolutionProgressListener = (snapshot: JobProgressSnapshot) => void;

function optionalTrim(raw: string | undefined): string | undefined {
  if (!raw) {
    return undefined;
  }
  const value = raw.trim();
  return value.length > 0 ? value : undefined;
}

function parseIntOr(raw: string | undefined, fallback: number): number {
  const value = optionalTrim(raw);
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(0, Math.floor(parsed));
}

function categoryFor(trigger: EvolutionJob['trigger']): EvolutionChangeCategory {
  return trigger === 'bug' ? 'bugfix' : 'exception';
}

function summarizeFixResult(result: AutoFixApplyResult): string {
  if (result.patchPath) {
    return `${result.note}\npatch: ${result.patchPath}`;
  }
  return result.note;
}

async function readTail(path: string, maxChars: number): Promise<string> {
  try {
    const content = await readFile(path, 'utf-8');
    return content.slice(-maxChars);
  } catch {
    return '';
  }
}

async function readPrefix(path: string, maxChars: number): Promise<string | undefined> {
  try {
    const content = await readFile(path, 'utf-8');
    return content.slice(0, maxChars);
  } catch {
    return undefined;
  }
}

export class EvolutionService {
  private readonly emitter = new EventEmitter();
  private readonly storage: EvolutionStorage;
  private readonly sandbox: EvolutionSandbox;
  private readonly autoFixer: EvolutionAutoFixer;
  private readonly baseBranch: string;
  private readonly defaultTestCommand: string;
  private readonly maxAutoFixAttempts: number;
  private readonly testTimeoutMs: number;
  private readonly testEnv?: NodeJS.ProcessEnv;
  private readonly autoStart: boolean;
  private readonly processing = new Map<string, Promise<void>>();

  constructor(options: EvolutionServiceOptions) {
    this.storage =
      options.storage ??
      new EvolutionStorage({
        rootDir: options.stateRoot
      });
    this.sandbox =
      options.sandbox ??
      new GitWorktreeSandbox({
        repoRoot: options.repoRoot,
        promoteMode: (process.env.EVOLUTION_PROMOTE_MODE === 'git-merge' ? 'git-merge' : 'pointer')
      });
    this.autoFixer =
      options.autoFixer ??
      (process.env.EVOLUTION_AUTOFIX_ENABLED === '1'
        ? new GeminiPatchAutoFixer({
            model: process.env.EVOLUTION_CODING_MODEL,
            enabled: true
          })
        : new NoopAutoFixer());
    this.baseBranch = options.baseBranch ?? optionalTrim(process.env.EVOLUTION_BASE_BRANCH) ?? 'main';
    this.defaultTestCommand =
      options.defaultTestCommand ?? optionalTrim(process.env.EVOLUTION_TEST_COMMAND) ?? 'npm test';
    this.maxAutoFixAttempts =
      options.maxAutoFixAttempts ?? parseIntOr(process.env.EVOLUTION_MAX_AUTOFIX_ATTEMPTS, 2);
    this.testTimeoutMs = options.testTimeoutMs ?? parseIntOr(process.env.EVOLUTION_TEST_TIMEOUT_MS, 600000);
    this.testEnv = options.testEnv;
    this.autoStart = options.autoStart ?? true;
  }

  private now(): string {
    return new Date().toISOString();
  }

  private async mustGetJob(jobId: string): Promise<EvolutionJob> {
    const job = await this.storage.getJob(jobId);
    if (!job) {
      throw new Error(`evolution job not found: ${jobId}`);
    }
    return job;
  }

  private async saveJob(job: EvolutionJob): Promise<void> {
    job.updatedAt = this.now();
    await this.storage.saveJob(job);
  }

  private async appendEvent(jobId: string, event: EvolutionEvent): Promise<void> {
    await this.storage.appendEvent(jobId, event);
    await this.publish(jobId);
  }

  private async transition(
    job: EvolutionJob,
    status: EvolutionJob['status'],
    message: string,
    details?: string
  ): Promise<void> {
    job.status = status;
    await this.saveJob(job);
    await this.appendEvent(job.id, {
      at: this.now(),
      stage: status,
      message,
      details
    });
  }

  private async addChange(
    job: EvolutionJob,
    category: EvolutionChangeCategory,
    summary: string,
    details?: string
  ): Promise<void> {
    job.changelog.push({
      at: this.now(),
      category,
      summary,
      details
    });
    await this.saveJob(job);
  }

  private snapshotEvent(jobId: string): string {
    return `snapshot:${jobId}`;
  }

  private async publish(jobId: string): Promise<void> {
    const snapshot = await this.getSnapshot(jobId);
    this.emitter.emit(this.snapshotEvent(jobId), snapshot);
  }

  onProgress(jobId: string, listener: EvolutionProgressListener): () => void {
    const event = this.snapshotEvent(jobId);
    this.emitter.on(event, listener);
    return () => {
      this.emitter.off(event, listener);
    };
  }

  async listJobs(): Promise<EvolutionJob[]> {
    return this.storage.listJobs();
  }

  async getSnapshot(jobId: string): Promise<JobProgressSnapshot> {
    const job = await this.mustGetJob(jobId);
    const events = await this.storage.listEvents(jobId);
    const activeVersion = await this.storage.getActiveVersion(job.workflowId);

    return {
      schemaVersion: 'evolution.job.snapshot.v1',
      emittedAt: this.now(),
      job,
      events,
      activeVersion
    };
  }

  async listVersionSummaries(): Promise<EvolutionVersionSummary[]> {
    const activePointers = await this.storage.listActiveVersions();
    const summaries: EvolutionVersionSummary[] = [];

    for (const pointer of activePointers) {
      const history = await this.storage.getVersionHistory(pointer.workflowId);
      summaries.push({
        workflowId: pointer.workflowId,
        current: pointer,
        history
      });
    }

    return summaries.sort((left, right) => {
      const leftAt = left.current?.promotedAt ?? '';
      const rightAt = right.current?.promotedAt ?? '';
      return rightAt.localeCompare(leftAt);
    });
  }

  async getVersionSummary(workflowId: string): Promise<EvolutionVersionSummary> {
    const current = await this.storage.getActiveVersion(workflowId);
    const history = await this.storage.getVersionHistory(workflowId);
    return {
      workflowId,
      current,
      history
    };
  }

  async getJobDiff(jobId: string): Promise<EvolutionJobDiffSnapshot> {
    const job = await this.mustGetJob(jobId);
    const candidate = job.candidate;

    const attempts =
      candidate?.testAttempts.map(async (attempt) => {
        const patchPath = resolve(
          this.storage.attemptsDir(job.id),
          `attempt-${String(attempt.attempt).padStart(3, '0')}.patch.diff`
        );
        const [outputTail, autoFixNote, patchPreview] = await Promise.all([
          readTail(attempt.outputPath, 3000),
          attempt.autoFixNotePath ? readPrefix(attempt.autoFixNotePath, 3000) : Promise.resolve(undefined),
          readPrefix(patchPath, 4000)
        ]);

        return {
          attempt: attempt.attempt,
          ok: attempt.ok,
          exitCode: attempt.exitCode,
          outputPath: attempt.outputPath,
          outputTail: outputTail.length > 0 ? outputTail : undefined,
          autoFixNotePath: attempt.autoFixNotePath,
          autoFixNote,
          patchPath: patchPreview ? patchPath : undefined,
          patchPreview
        };
      }) ?? [];

    return {
      schemaVersion: 'evolution.job.diff.v1',
      emittedAt: this.now(),
      jobId: job.id,
      workflowId: job.workflowId,
      status: job.status,
      candidateVersion: candidate?.version,
      branchName: candidate?.branchName,
      worktreePath: candidate?.worktreePath,
      attempts: await Promise.all(attempts)
    };
  }

  async createJob(request: CreateEvolutionJobInput): Promise<JobProgressSnapshot> {
    if (request.trigger !== 'bug' && request.trigger !== 'exception') {
      throw new Error('evolution is only allowed for bug/exception triggers');
    }

    const modelPolicy = resolveEvolutionModelPolicy();
    const created = await this.storage.createJob({
      request,
      modelPolicy,
      baseBranch: request.baseBranch ?? this.baseBranch,
      testCommand: request.testCommand ?? this.defaultTestCommand,
      maxAutoFixAttempts: request.maxAutoFixAttempts ?? this.maxAutoFixAttempts
    });

    await this.publish(created.id);

    if (this.autoStart) {
      void this.startJob(created.id);
    }

    return this.getSnapshot(created.id);
  }

  async startJob(jobId: string): Promise<void> {
    const running = this.processing.get(jobId);
    if (running) {
      return running;
    }

    const promise = this.runJob(jobId).finally(() => {
      this.processing.delete(jobId);
    });

    this.processing.set(jobId, promise);
    return promise;
  }

  async waitForCompletion(jobId: string): Promise<JobProgressSnapshot> {
    const running = this.processing.get(jobId);
    if (running) {
      await running;
    }
    return this.getSnapshot(jobId);
  }

  async retryJob(jobId: string): Promise<JobProgressSnapshot> {
    const job = await this.mustGetJob(jobId);
    if (job.status !== 'failed' && job.status !== 'rejected') {
      throw new Error(`retry is only allowed for failed/rejected jobs (current: ${job.status})`);
    }

    job.status = 'draft';
    job.lastError = undefined;
    await this.saveJob(job);
    await this.appendEvent(job.id, {
      at: this.now(),
      stage: 'created',
      message: 'Job retry requested'
    });

    await this.startJob(job.id);
    return this.getSnapshot(job.id);
  }

  private async runJob(jobId: string): Promise<void> {
    const job = await this.mustGetJob(jobId);

    if (job.status !== 'draft' && job.status !== 'failed' && job.status !== 'rejected') {
      await this.appendEvent(job.id, {
        at: this.now(),
        stage: 'created',
        message: `Skip start because job is in status ${job.status}`
      });
      return;
    }

    const nextVersion = job.currentVersion + 1;

    await this.transition(job, 'sandbox_prepared', 'Preparing isolated worktree sandbox');

    const prepared = await this.sandbox.prepareCandidate({
      jobId: job.id,
      workflowId: job.workflowId,
      baseBranch: job.baseBranch,
      version: nextVersion
    });

    job.currentVersion = nextVersion;
    job.candidate = {
      version: nextVersion,
      branchName: prepared.branchName,
      baseBranch: job.baseBranch,
      worktreePath: prepared.worktreePath,
      scenarioPackPath: '',
      attempts: 0,
      testAttempts: []
    };
    await this.addChange(
      job,
      'ops',
      `candidate version ${nextVersion} prepared in isolated worktree`,
      `${prepared.worktreePath}`
    );

    const scenarioPack = await buildScenarioPack({
      job,
      outputDir: this.storage.scenarioPackDir(job.id),
      failureHint: job.lastError
    });

    job.candidate.scenarioPackPath = scenarioPack.scenarioPackPath;
    await this.saveJob(job);
    await this.appendEvent(job.id, {
      at: this.now(),
      stage: 'scenario_pack',
      message: 'Scenario pack generated with baseline + exception matrix',
      details: scenarioPack.exceptionsPath
    });

    const totalAttempts = Math.max(1, job.maxAutoFixAttempts + 1);

    for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
      await this.transition(job, 'testing', `Running candidate tests (attempt ${attempt}/${totalAttempts})`);

      const outputPath = this.storage.attemptOutputPath(job.id, attempt);
      const run = await this.sandbox.runTests({
        cwd: prepared.worktreePath,
        command: job.testCommand,
        outputPath,
        timeoutMs: this.testTimeoutMs,
        env: this.testEnv
      });

      const attemptRecord = {
        attempt,
        startedAt: run.startedAt,
        endedAt: run.endedAt,
        ok: run.ok,
        exitCode: run.exitCode,
        outputPath: run.outputPath
      };

      job.candidate.attempts = attempt;
      job.candidate.testAttempts.push(attemptRecord);
      await this.saveJob(job);

      if (run.ok) {
        await this.addChange(
          job,
          categoryFor(job.trigger),
          `candidate v${nextVersion} passed tests`,
          `command: ${job.testCommand}`
        );
        await this.transition(job, 'awaiting_approval', 'Candidate passed tests, waiting for user confirmation');
        return;
      }

      job.lastError = await readTail(run.outputPath, 4000);
      await this.saveJob(job);

      const hasNextAttempt = attempt < totalAttempts;
      if (!hasNextAttempt) {
        break;
      }

      await this.transition(job, 'auto_fixing', `Auto-fix attempt ${attempt}/${job.maxAutoFixAttempts}`);

      const patchPath = resolve(
        this.storage.attemptsDir(job.id),
        `attempt-${String(attempt).padStart(3, '0')}.patch.diff`
      );
      const fixResult = await this.autoFixer.apply({
        attempt,
        worktreePath: prepared.worktreePath,
        failureLogPath: run.outputPath,
        codingModel: job.modelPolicy.codingModel,
        outputPatchPath: patchPath
      });

      const notePath = this.storage.attemptAutoFixNotePath(job.id, attempt);
      const note = [
        `# Auto Fix Attempt ${attempt}`,
        '',
        `- model: ${job.modelPolicy.codingModel}`,
        `- applied: ${fixResult.applied}`,
        `- note: ${summarizeFixResult(fixResult)}`,
        ''
      ].join('\n');
      await writeFile(notePath, note, 'utf-8');

      const record = job.candidate.testAttempts[job.candidate.testAttempts.length - 1];
      if (record) {
        record.autoFixNotePath = notePath;
      }
      await this.saveJob(job);

      await this.addChange(
        job,
        categoryFor(job.trigger),
        `auto-fix attempt ${attempt} processed`,
        summarizeFixResult(fixResult)
      );
    }

    await this.transition(job, 'failed', 'Candidate failed after all test/auto-fix attempts', job.lastError);
  }

  async approveJob(jobId: string, input: ApproveEvolutionJobInput): Promise<JobProgressSnapshot> {
    const job = await this.mustGetJob(jobId);

    if (job.status !== 'awaiting_approval') {
      throw new Error(`job is not awaiting approval (current: ${job.status})`);
    }

    if (!job.candidate) {
      throw new Error('candidate version is missing');
    }

    const promotion = await this.sandbox.promoteCandidate({
      baseBranch: job.baseBranch,
      candidateBranch: job.candidate.branchName
    });

    if (!promotion.ok) {
      await this.transition(job, 'failed', 'Promotion failed', promotion.message);
      return this.getSnapshot(jobId);
    }

    await this.storage.setActiveVersion({
      workflowId: job.workflowId,
      jobId: job.id,
      version: job.candidate.version,
      branchName: job.candidate.branchName,
      worktreePath: job.candidate.worktreePath,
      promotedAt: this.now(),
      confirmedBy: input.confirmedBy
    });

    await this.addChange(
      job,
      'feature',
      `candidate v${job.candidate.version} promoted to active version`,
      input.note
    );

    await this.transition(job, 'promoted', `Promotion approved by ${input.confirmedBy}`, promotion.message);
    await this.appendEvent(job.id, {
      at: this.now(),
      stage: 'promotion',
      message: 'Active version pointer updated',
      details: input.note
    });

    return this.getSnapshot(jobId);
  }

  async rejectJob(jobId: string, input: RejectEvolutionJobInput): Promise<JobProgressSnapshot> {
    const job = await this.mustGetJob(jobId);

    if (job.status !== 'awaiting_approval') {
      throw new Error(`job is not awaiting approval (current: ${job.status})`);
    }

    await this.addChange(job, 'ops', 'candidate rejected', input.reason);
    await this.transition(job, 'rejected', `Candidate rejected by ${input.rejectedBy}`, input.reason);

    return this.getSnapshot(jobId);
  }
}
