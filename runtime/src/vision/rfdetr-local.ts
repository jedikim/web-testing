import { spawn } from 'node:child_process';

import type { CompositeDetection } from './composite-sheet';

export interface RunRfDetrLocalInput {
  imagePath: string;
  labels?: string[];
  timeoutMs?: number;
}

export interface RunRfDetrLocalOutput {
  detections: CompositeDetection[];
  accepted?: boolean;
  reason?: string;
  provider?: string;
  model?: string;
}

function trimOptional(raw: string | undefined): string | undefined {
  if (!raw) {
    return undefined;
  }
  const value = raw.trim();
  return value.length > 0 ? value : undefined;
}

function parseBoolean(raw: string | undefined): boolean {
  const normalized = raw?.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function parseCsv(raw: string | undefined): string[] {
  if (!raw) {
    return [];
  }
  return raw
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function normalizeBBox(raw: unknown): [number, number, number, number] | undefined {
  if (!Array.isArray(raw) || raw.length !== 4) {
    return undefined;
  }
  const values = raw.map((value) => Number(value));
  if (!values.every((value) => Number.isFinite(value))) {
    return undefined;
  }
  const [x1, y1, x2, y2] = values as [number, number, number, number];
  if (x2 <= x1 || y2 <= y1) {
    return undefined;
  }
  return [x1, y1, x2, y2];
}

function sanitizeDetections(raw: unknown): CompositeDetection[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const rows: CompositeDetection[] = [];
  for (const entry of raw.slice(0, 256)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const bbox = normalizeBBox(record.bbox);
    if (!bbox) {
      continue;
    }
    rows.push({
      bbox,
      label: typeof record.label === 'string' ? record.label : undefined,
      confidence: Number.isFinite(Number(record.confidence)) ? Number(record.confidence) : undefined
    });
  }
  return rows;
}

function extractFirstJsonObject(raw: string): string | undefined {
  const text = raw.trim();
  if (!text) {
    return undefined;
  }
  const starts: number[] = [];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '{') {
      starts.push(index);
    }
  }
  for (const start of starts) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < text.length; index += 1) {
      const ch = text[index]!;
      if (inString) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (ch === '\\') {
          escaped = true;
          continue;
        }
        if (ch === '"') {
          inString = false;
        }
        continue;
      }
      if (ch === '"') {
        inString = true;
        continue;
      }
      if (ch === '{') {
        depth += 1;
        continue;
      }
      if (ch === '}') {
        depth -= 1;
        if (depth === 0) {
          return text.slice(start, index + 1);
        }
      }
    }
  }
  return undefined;
}

async function runCommand(command: string, payload: object, timeoutMs: number): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('bash', ['-lc', command], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      child.kill('SIGKILL');
      reject(new Error(`rfdetr local command timeout (${timeoutMs}ms)`));
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      stdout.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr.push(chunk);
    });

    child.on('error', (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      reject(error);
    });

    child.on('close', (code) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      const out = Buffer.concat(stdout).toString('utf-8');
      if (code !== 0) {
        const err = Buffer.concat(stderr).toString('utf-8').trim();
        reject(new Error(`rfdetr local command failed (exit=${code}): ${err || 'no stderr'}`));
        return;
      }
      resolvePromise(out);
    });

    child.stdin.write(`${JSON.stringify(payload)}\n`);
    child.stdin.end();
  });
}

function readEnvEnabled(): boolean {
  return parseBoolean(process.env.RFDETR_ENABLED);
}

function readEnvCommand(): string | undefined {
  return trimOptional(process.env.RFDETR_LOCAL_COMMAND);
}

function readEnvModel(): string {
  const preferred = parseCsv(process.env.RFDETR_MODELS);
  if (preferred.length > 0) {
    return preferred[0]!;
  }
  return 'rf-detr-medium';
}

function readEnvTimeoutMs(): number {
  const timeoutRaw = Number(process.env.RFDETR_LOCAL_TIMEOUT_MS);
  if (!Number.isFinite(timeoutRaw) || timeoutRaw <= 0) {
    return 45_000;
  }
  return Math.min(120_000, Math.max(5_000, Math.floor(timeoutRaw)));
}

export async function runRfDetrLocal(input: RunRfDetrLocalInput): Promise<RunRfDetrLocalOutput> {
  if (!readEnvEnabled()) {
    return {
      detections: [],
      accepted: false,
      reason: 'rfdetr disabled (RFDETR_ENABLED!=1)',
      provider: 'rfdetr'
    };
  }

  const command = readEnvCommand();
  if (!command) {
    return {
      detections: [],
      accepted: false,
      reason: 'rfdetr local command not configured (RFDETR_LOCAL_COMMAND missing)',
      provider: 'rfdetr'
    };
  }

  const model = readEnvModel();
  const timeoutMs = readEnvTimeoutMs();

  const payload = {
    imagePath: input.imagePath,
    model,
    labels: input.labels ?? []
  };

  try {
    const raw = await runCommand(command, payload, timeoutMs);
    const jsonText = extractFirstJsonObject(raw);
    if (!jsonText) {
      return {
        detections: [],
        accepted: false,
        reason: 'rfdetr command returned no JSON object',
        provider: 'rfdetr',
        model
      };
    }
    const parsed = JSON.parse(jsonText) as Record<string, unknown>;
    return {
      detections: sanitizeDetections(parsed.detections),
      accepted: typeof parsed.accepted === 'boolean' ? parsed.accepted : undefined,
      reason: typeof parsed.reason === 'string' ? parsed.reason : undefined,
      provider: 'rfdetr',
      model
    };
  } catch (error) {
    return {
      detections: [],
      accepted: false,
      reason: error instanceof Error ? error.message : String(error),
      provider: 'rfdetr',
      model
    };
  }
}
