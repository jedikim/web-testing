import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface LoadEnvFilesOptions {
  cwd?: string;
  filenames?: string[];
  override?: boolean;
  target?: NodeJS.ProcessEnv;
}

export interface LoadEnvFilesResult {
  loadedFiles: string[];
}

function stripWrappingQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    const inner = value.slice(1, -1);
    if (value.startsWith('"')) {
      return inner
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '\r')
        .replace(/\\t/g, '\t')
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\');
    }
    return inner;
  }
  return value;
}

function parseAssignment(line: string): { key: string; value: string } | undefined {
  const trimmed = line.trim();
  if (trimmed.length === 0 || trimmed.startsWith('#')) {
    return undefined;
  }

  const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
  if (!match) {
    return undefined;
  }

  return {
    key: match[1]!,
    value: stripWrappingQuotes(match[2]!.trim())
  };
}

export function loadEnvFiles(options: LoadEnvFilesOptions = {}): LoadEnvFilesResult {
  const cwd = options.cwd ?? process.cwd();
  const filenames = options.filenames ?? ['runtime/.env', '.env'];
  const override = options.override ?? false;
  const target = options.target ?? process.env;
  const loadedFiles: string[] = [];

  for (const filename of filenames) {
    const path = resolve(cwd, filename);
    if (!existsSync(path)) {
      continue;
    }

    const lines = readFileSync(path, 'utf-8').split(/\r?\n/);
    for (const line of lines) {
      const assignment = parseAssignment(line);
      if (!assignment) {
        continue;
      }
      if (!override && target[assignment.key] != null) {
        continue;
      }
      target[assignment.key] = assignment.value;
    }
    loadedFiles.push(path);
  }

  return { loadedFiles };
}
