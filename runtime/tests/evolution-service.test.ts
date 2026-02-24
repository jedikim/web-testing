import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { EvolutionAutoFixer } from '../src/evolution/gemini-autofix';
import type {
  EvolutionSandbox,
  PrepareCandidateInput,
  RunTestsInput,
  RunTestsResult
} from '../src/evolution/git-sandbox';
import { EvolutionService } from '../src/evolution/service';

class SequenceSandbox implements EvolutionSandbox {
  private readonly results: boolean[];

  constructor(results: boolean[]) {
    this.results = [...results];
  }

  async prepareCandidate(input: PrepareCandidateInput) {
    const worktreePath = resolve(tmpdir(), `evolution-${input.jobId}-${input.version}`);
    await mkdir(worktreePath, { recursive: true });
    return {
      branchName: `evolution/${input.jobId}/v${String(input.version).padStart(3, '0')}`,
      worktreePath
    };
  }

  async runTests(input: RunTestsInput): Promise<RunTestsResult> {
    const ok = this.results.shift() ?? false;
    await mkdir(resolve(input.outputPath, '..'), { recursive: true });
    await writeFile(input.outputPath, ok ? 'pass' : 'fail: selector not found', 'utf-8');

    const now = new Date().toISOString();
    return {
      ok,
      exitCode: ok ? 0 : 1,
      startedAt: now,
      endedAt: now,
      outputPath: input.outputPath
    };
  }

  async promoteCandidate() {
    return {
      ok: true,
      message: 'pointer promoted'
    };
  }
}

class AlwaysApplyFixer implements EvolutionAutoFixer {
  async apply() {
    return {
      applied: true,
      note: 'mock patch applied',
      patchPath: '/tmp/mock.patch'
    };
  }
}

describe('EvolutionService', () => {
  it('runs test -> auto-fix -> test loop and reaches awaiting approval', async () => {
    const stateRoot = await mkdtemp(resolve(tmpdir(), 'evo-service-state-'));

    const service = new EvolutionService({
      repoRoot: process.cwd(),
      stateRoot,
      autoStart: true,
      sandbox: new SequenceSandbox([false, true]),
      autoFixer: new AlwaysApplyFixer(),
      defaultTestCommand: 'echo test',
      maxAutoFixAttempts: 2
    });

    const created = await service.createJob({
      title: 'selector drift recovery',
      trigger: 'exception',
      workflowId: 'kr-scenario-001'
    });

    const finalSnapshot = await service.waitForCompletion(created.job.id);
    expect(finalSnapshot.job.status).toBe('awaiting_approval');
    expect(finalSnapshot.job.candidate?.attempts).toBe(2);
    expect(finalSnapshot.job.candidate?.testAttempts.length).toBe(2);
    expect(finalSnapshot.job.changelog.some((entry) => entry.category === 'exception')).toBe(true);

    const diff = await service.getJobDiff(created.job.id);
    expect(diff.schemaVersion).toBe('evolution.job.diff.v1');
    expect(diff.attempts.length).toBe(2);
    expect(diff.attempts[0]?.outputTail).toBeDefined();

    await rm(stateRoot, { recursive: true, force: true });
  });

  it('promotes candidate after user approval and stores active version pointer', async () => {
    const stateRoot = await mkdtemp(resolve(tmpdir(), 'evo-service-approve-'));

    const service = new EvolutionService({
      repoRoot: process.cwd(),
      stateRoot,
      autoStart: true,
      sandbox: new SequenceSandbox([true]),
      autoFixer: new AlwaysApplyFixer(),
      defaultTestCommand: 'echo test',
      maxAutoFixAttempts: 0
    });

    const created = await service.createJob({
      title: 'bugfix pass',
      trigger: 'bug',
      workflowId: 'kr-scenario-approve'
    });

    await service.waitForCompletion(created.job.id);
    const approved = await service.approveJob(created.job.id, {
      confirmedBy: 'qa-user',
      note: 'approved in test'
    });

    expect(approved.job.status).toBe('promoted');
    expect(approved.activeVersion?.workflowId).toBe('kr-scenario-approve');
    expect(approved.activeVersion?.confirmedBy).toBe('qa-user');

    const versionSummary = await service.getVersionSummary('kr-scenario-approve');
    expect(versionSummary.current?.version).toBe(1);
    expect(versionSummary.history.length).toBeGreaterThan(0);

    await rm(stateRoot, { recursive: true, force: true });
  });

  it('fails after exhausting all auto-fix attempts', async () => {
    const stateRoot = await mkdtemp(resolve(tmpdir(), 'evo-service-fail-'));

    const service = new EvolutionService({
      repoRoot: process.cwd(),
      stateRoot,
      autoStart: true,
      sandbox: new SequenceSandbox([false, false]),
      autoFixer: new AlwaysApplyFixer(),
      defaultTestCommand: 'echo test',
      maxAutoFixAttempts: 1
    });

    const created = await service.createJob({
      title: 'unstable flow',
      trigger: 'exception',
      workflowId: 'kr-scenario-fail'
    });

    const snapshot = await service.waitForCompletion(created.job.id);
    expect(snapshot.job.status).toBe('failed');
    expect(snapshot.job.candidate?.attempts).toBe(2);

    await rm(stateRoot, { recursive: true, force: true });
  });
});
