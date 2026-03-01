import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import type { CommandExecutor } from './git-sandbox';
import { NodeCommandExecutor } from './git-sandbox';
import { EVOLUTION_AUTOFIX_PROMPT_V1 } from '../prompts/evolution-autofix';
import { promptTag } from '../prompts/types';

export interface AutoFixApplyInput {
  attempt: number;
  worktreePath: string;
  failureLogPath: string;
  codingModel: string;
  outputPatchPath: string;
}

export interface AutoFixApplyResult {
  applied: boolean;
  note: string;
  patchPath?: string;
}

export interface EvolutionAutoFixer {
  apply(input: AutoFixApplyInput): Promise<AutoFixApplyResult>;
}

export interface GeminiPatchAutoFixerOptions {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  executor?: CommandExecutor;
  timeoutMs?: number;
  enabled?: boolean;
}

function optionalTrim(raw: string | undefined): string | undefined {
  if (!raw) {
    return undefined;
  }
  const value = raw.trim();
  return value.length > 0 ? value : undefined;
}

function extractPatch(text: string): string | undefined {
  const match = text.match(/```diff\s*([\s\S]*?)```/i);
  if (match?.[1]) {
    return match[1].trim();
  }
  return undefined;
}

function extractTextFromGeminiResponse(payload: unknown): string {
  if (!payload || typeof payload !== 'object') {
    return '';
  }

  const candidates = (payload as Record<string, unknown>).candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return '';
  }

  const first = candidates[0] as Record<string, unknown>;
  const content = first.content as Record<string, unknown> | undefined;
  const parts = content?.parts;
  if (!Array.isArray(parts)) {
    return '';
  }

  return parts
    .map((part) => {
      if (part && typeof part === 'object' && typeof (part as Record<string, unknown>).text === 'string') {
        return (part as Record<string, string>).text;
      }
      return '';
    })
    .join('\n');
}

export class GeminiPatchAutoFixer implements EvolutionAutoFixer {
  private readonly apiKey?: string;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly executor: CommandExecutor;
  private readonly timeoutMs: number;
  private readonly enabled: boolean;

  constructor(options: GeminiPatchAutoFixerOptions = {}) {
    this.apiKey = optionalTrim(options.apiKey) ?? optionalTrim(process.env.GEMINI_API_KEY);
    this.model = options.model ?? process.env.EVOLUTION_CODING_MODEL ?? 'gemini-3.1-pro-preview';
    this.baseUrl =
      options.baseUrl ??
      process.env.GEMINI_BASE_URL ??
      'https://generativelanguage.googleapis.com/v1beta';
    this.executor = options.executor ?? new NodeCommandExecutor();
    this.timeoutMs = options.timeoutMs ?? 120000;
    this.enabled = options.enabled ?? process.env.EVOLUTION_AUTOFIX_ENABLED === '1';
  }

  private async requestPatch(input: AutoFixApplyInput): Promise<string | undefined> {
    if (!this.apiKey) {
      return undefined;
    }

    const rawFailure = await readFile(input.failureLogPath, 'utf-8');
    const clippedFailure = rawFailure.slice(-16000);

    const prompt = EVOLUTION_AUTOFIX_PROMPT_V1.render({
      failureLog: clippedFailure
    });

    const endpoint = `${this.baseUrl}/models/${this.model}:generateContent?key=${this.apiKey}`;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.1
        }
      }),
      signal: AbortSignal.timeout(this.timeoutMs)
    });

    if (!response.ok) {
      return undefined;
    }

    const json = (await response.json()) as unknown;
    const text = extractTextFromGeminiResponse(json);
    return extractPatch(text);
  }

  async apply(input: AutoFixApplyInput): Promise<AutoFixApplyResult> {
    if (!this.enabled) {
      return {
        applied: false,
        note: 'auto-fix disabled; EVOLUTION_AUTOFIX_ENABLED=1 required'
      };
    }

    if (!this.apiKey) {
      return {
        applied: false,
        note: 'auto-fix skipped because GEMINI_API_KEY is missing'
      };
    }

    const patch = await this.requestPatch(input);
    if (!patch) {
      return {
        applied: false,
        note: 'gemini did not return a valid diff patch'
      };
    }

    await writeFile(input.outputPatchPath, `${patch}\n`, 'utf-8');

    const applyResult = await this.executor.run('git', ['apply', input.outputPatchPath], {
      cwd: input.worktreePath
    });

    if (applyResult.exitCode !== 0) {
      return {
        applied: false,
        note: `patch apply failed: ${applyResult.output.trim()}`,
        patchPath: resolve(input.outputPatchPath)
      };
    }

    return {
      applied: true,
      note: `gemini patch applied successfully (${promptTag(EVOLUTION_AUTOFIX_PROMPT_V1)})`,
      patchPath: resolve(input.outputPatchPath)
    };
  }
}

export class NoopAutoFixer implements EvolutionAutoFixer {
  async apply(): Promise<AutoFixApplyResult> {
    return {
      applied: false,
      note: 'no-op auto fixer configured'
    };
  }
}
