import type { LlmProviderTarget, VisionProviderTarget } from '../config/provider-matrix-env';

export interface LlmExecutionTarget {
  provider: LlmProviderTarget['provider'];
  apiKey: string;
  baseUrl?: string;
  model: string;
}

export interface VisionExecutionTarget {
  provider: 'yolo26';
  apiKey?: string;
  baseUrl: string;
  model: string;
}

export interface ExecutionResult {
  ok: boolean;
  error?: string;
}

export interface ProviderModelMatrixInput {
  llmTargets: LlmProviderTarget[];
  visionTargets: VisionProviderTarget[];
  executeLlm: (target: LlmExecutionTarget) => Promise<ExecutionResult>;
  executeVision: (target: VisionExecutionTarget) => Promise<ExecutionResult>;
}

export interface ProviderModelMatrixRow {
  type: 'llm' | 'vision';
  provider: string;
  model: string;
  status: 'pass' | 'fail';
  error?: string;
}

export interface ProviderModelMatrixReport {
  rows: ProviderModelMatrixRow[];
  summary: {
    total: number;
    passed: number;
    failed: number;
  };
}

export async function runProviderModelMatrix(
  input: ProviderModelMatrixInput
): Promise<ProviderModelMatrixReport> {
  const rows: ProviderModelMatrixRow[] = [];

  for (const target of input.llmTargets) {
    for (const model of target.models) {
      try {
        const result = await input.executeLlm({
          provider: target.provider,
          apiKey: target.apiKey,
          baseUrl: target.baseUrl,
          model
        });
        rows.push({
          type: 'llm',
          provider: target.provider,
          model,
          status: result.ok ? 'pass' : 'fail',
          error: result.ok ? undefined : result.error ?? 'unknown llm error'
        });
      } catch (error) {
        rows.push({
          type: 'llm',
          provider: target.provider,
          model,
          status: 'fail',
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
  }

  for (const target of input.visionTargets) {
    for (const model of target.models) {
      try {
        const result = await input.executeVision({
          provider: 'yolo26',
          apiKey: target.apiKey,
          baseUrl: target.baseUrl,
          model
        });
        rows.push({
          type: 'vision',
          provider: target.provider,
          model,
          status: result.ok ? 'pass' : 'fail',
          error: result.ok ? undefined : result.error ?? 'unknown vision error'
        });
      } catch (error) {
        rows.push({
          type: 'vision',
          provider: target.provider,
          model,
          status: 'fail',
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
  }

  const passed = rows.filter((row) => row.status === 'pass').length;
  const failed = rows.length - passed;

  return {
    rows,
    summary: {
      total: rows.length,
      passed,
      failed
    }
  };
}
