import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';

export interface CommandResult {
  exitCode: number;
  output: string;
}

export interface CommandExecutor {
  run(
    command: string,
    args: string[],
    options: {
      cwd: string;
      env?: NodeJS.ProcessEnv;
      timeoutMs?: number;
    }
  ): Promise<CommandResult>;
}

export class NodeCommandExecutor implements CommandExecutor {
  async run(
    command: string,
    args: string[],
    options: {
      cwd: string;
      env?: NodeJS.ProcessEnv;
      timeoutMs?: number;
    }
  ): Promise<CommandResult> {
    return new Promise<CommandResult>((resolvePromise, rejectPromise) => {
      const child = spawn(command, args, {
        cwd: options.cwd,
        env: options.env ?? process.env,
        stdio: 'pipe'
      });

      let output = '';
      child.stdout.on('data', (chunk) => {
        output += chunk.toString();
      });
      child.stderr.on('data', (chunk) => {
        output += chunk.toString();
      });

      let timeoutId: NodeJS.Timeout | undefined;
      if (options.timeoutMs && options.timeoutMs > 0) {
        timeoutId = setTimeout(() => {
          child.kill('SIGTERM');
        }, options.timeoutMs);
      }

      child.on('error', (error) => {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        rejectPromise(error);
      });

      child.on('close', (code) => {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        resolvePromise({
          exitCode: code ?? 1,
          output
        });
      });
    });
  }
}

export interface PrepareCandidateInput {
  jobId: string;
  workflowId: string;
  baseBranch: string;
  version: number;
}

export interface PreparedCandidate {
  branchName: string;
  worktreePath: string;
}

export interface RunTestsInput {
  cwd: string;
  command: string;
  outputPath: string;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
}

export interface RunTestsResult {
  ok: boolean;
  exitCode: number;
  startedAt: string;
  endedAt: string;
  outputPath: string;
}

export interface PromoteCandidateInput {
  baseBranch: string;
  candidateBranch: string;
}

export interface PromoteCandidateResult {
  ok: boolean;
  message: string;
}

export interface EvolutionSandbox {
  prepareCandidate(input: PrepareCandidateInput): Promise<PreparedCandidate>;
  runTests(input: RunTestsInput): Promise<RunTestsResult>;
  promoteCandidate(input: PromoteCandidateInput): Promise<PromoteCandidateResult>;
}

export interface GitWorktreeSandboxOptions {
  repoRoot: string;
  worktreeRoot?: string;
  executor?: CommandExecutor;
  promoteMode?: 'pointer' | 'git-merge';
}

function sanitizeName(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9._-]/g, '-');
}

function versionTag(version: number): string {
  return `v${String(version).padStart(3, '0')}`;
}

export class GitWorktreeSandbox implements EvolutionSandbox {
  private readonly repoRoot: string;
  private readonly worktreeRoot: string;
  private readonly executor: CommandExecutor;
  private readonly promoteMode: 'pointer' | 'git-merge';

  constructor(options: GitWorktreeSandboxOptions) {
    this.repoRoot = resolve(options.repoRoot);
    this.worktreeRoot = resolve(options.worktreeRoot ?? resolve(this.repoRoot, '.worktrees'));
    this.executor = options.executor ?? new NodeCommandExecutor();
    this.promoteMode = options.promoteMode ?? 'pointer';
  }

  async prepareCandidate(input: PrepareCandidateInput): Promise<PreparedCandidate> {
    const workflow = sanitizeName(input.workflowId);
    const id = sanitizeName(input.jobId);
    const tag = versionTag(input.version);
    const branchName = `evolution/${workflow}/${id}-${tag}`;
    const worktreePath = resolve(this.worktreeRoot, `${workflow}-${id}-${tag}`);

    await mkdir(this.worktreeRoot, { recursive: true });
    const addResult = await this.executor.run(
      'git',
      ['worktree', 'add', worktreePath, '-b', branchName, input.baseBranch],
      {
        cwd: this.repoRoot
      }
    );

    if (addResult.exitCode !== 0) {
      throw new Error(`failed to create worktree: ${addResult.output.trim()}`);
    }

    return {
      branchName,
      worktreePath
    };
  }

  async runTests(input: RunTestsInput): Promise<RunTestsResult> {
    const startedAt = new Date().toISOString();
    const result = await this.executor.run('bash', ['-lc', input.command], {
      cwd: input.cwd,
      timeoutMs: input.timeoutMs,
      env: input.env
    });
    const endedAt = new Date().toISOString();

    await mkdir(dirname(input.outputPath), { recursive: true });
    await writeFile(input.outputPath, result.output, 'utf-8');

    return {
      ok: result.exitCode === 0,
      exitCode: result.exitCode,
      startedAt,
      endedAt,
      outputPath: input.outputPath
    };
  }

  async promoteCandidate(input: PromoteCandidateInput): Promise<PromoteCandidateResult> {
    if (this.promoteMode === 'pointer') {
      return {
        ok: true,
        message: 'Pointer promotion selected; git merge skipped'
      };
    }

    const mergeResult = await this.executor.run(
      'git',
      ['merge', '--no-ff', '--no-edit', input.candidateBranch],
      { cwd: this.repoRoot }
    );

    if (mergeResult.exitCode !== 0) {
      return {
        ok: false,
        message: `git merge failed: ${mergeResult.output.trim()}`
      };
    }

    return {
      ok: true,
      message: `merged ${input.candidateBranch} into ${input.baseBranch}`
    };
  }
}
