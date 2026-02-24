import type { ExecutionResult, LlmExecutionTarget, VisionExecutionTarget } from './provider-model-matrix';

interface HttpProviderExecutorOptions {
  llmPrompt: string;
  visionInput: string;
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

      const baseUrl = stripTrailingSlash(target.baseUrl ?? 'https://api.anthropic.com/v1');
      const response = await fetch(`${baseUrl}/messages`, {
        method: 'POST',
        headers: {
          'x-api-key': target.apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: target.model,
          max_tokens: 128,
          messages: [{ role: 'user', content: options.llmPrompt }]
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

  const executeVision = async (target: VisionExecutionTarget): Promise<ExecutionResult> => {
    try {
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
          input: options.visionInput
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
