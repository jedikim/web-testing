import type { ExecutionResult, LlmExecutionTarget, VisionExecutionTarget } from './provider-model-matrix';

interface HttpProviderExecutorOptions {
  llmPrompt: string;
  visionInput: string | string[];
  createCompositeVisionInput?: (inputPaths: string[]) => Promise<string>;
}

function stripTrailingSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

async function parseError(response: Response): Promise<string> {
  const text = await response.text();
  return text || `http ${response.status}`;
}

export function createHttpProviderExecutors(options: HttpProviderExecutorOptions): {
  executeLlm: (target: LlmExecutionTarget) => Promise<ExecutionResult>;
  executeVision: (target: VisionExecutionTarget) => Promise<ExecutionResult>;
} {
  const resolveVisionInput = async (): Promise<string> => {
    if (!Array.isArray(options.visionInput)) {
      return options.visionInput;
    }

    if (options.visionInput.length === 0) {
      throw new Error('visionInput list must not be empty');
    }

    if (options.visionInput.length === 1) {
      return options.visionInput[0]!;
    }

    if (!options.createCompositeVisionInput) {
      throw new Error('createCompositeVisionInput is required when visionInput has multiple images');
    }

    return options.createCompositeVisionInput(options.visionInput);
  };

  const executeLlm = async (target: LlmExecutionTarget): Promise<ExecutionResult> => {
    try {
      if (target.provider === 'openai') {
        const baseUrl = stripTrailingSlash(target.baseUrl ?? 'https://api.openai.com/v1');
        const response = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${target.apiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: target.model,
            messages: [{ role: 'user', content: options.llmPrompt }],
            max_tokens: 128
          })
        });
        if (!response.ok) {
          return { ok: false, error: await parseError(response) };
        }
        return { ok: true };
      }

      if (target.provider === 'gemini') {
        const baseUrl = stripTrailingSlash(
          target.baseUrl ?? 'https://generativelanguage.googleapis.com/v1beta'
        );
        const response = await fetch(
          `${baseUrl}/models/${target.model}:generateContent?key=${encodeURIComponent(target.apiKey)}`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              contents: [{ parts: [{ text: options.llmPrompt }] }]
            })
          }
        );
        if (!response.ok) {
          return { ok: false, error: await parseError(response) };
        }
        return { ok: true };
      }

      return {
        ok: false,
        error: `unsupported llm provider: ${target.provider}`
      };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  };

  const executeVision = async (target: VisionExecutionTarget): Promise<ExecutionResult> => {
    try {
      const visionInput = await resolveVisionInput();
      const baseUrl = stripTrailingSlash(target.baseUrl);
      const headers: Record<string, string> = {
        'Content-Type': 'application/json'
      };
      if (target.apiKey) {
        headers.Authorization = `Bearer ${target.apiKey}`;
      }
      const response = await fetch(`${baseUrl}/detect`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: target.model,
          input: visionInput
        })
      });
      if (!response.ok) {
        return { ok: false, error: await parseError(response) };
      }
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  };

  return { executeLlm, executeVision };
}
