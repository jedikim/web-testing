import { afterEach, describe, expect, it, vi } from 'vitest';

import { createHttpProviderExecutors } from '../src/testing/provider-http-executor';

describe('createHttpProviderExecutors', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls provider specific endpoints for openai/gemini/anthropic/yolo26', async () => {
    const calls: Array<{ url: string; method: string; body: unknown; headers: Record<string, string> }> = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const normalizedHeaders: Record<string, string> = {};
      if (init?.headers) {
        for (const [key, value] of Object.entries(init.headers as Record<string, string>)) {
          normalizedHeaders[key.toLowerCase()] = String(value);
        }
      }
      calls.push({
        url,
        method: init?.method ?? 'GET',
        body: init?.body ? JSON.parse(String(init.body)) : null,
        headers: normalizedHeaders
      });

      if (url.includes('/chat/completions')) {
        return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), {
          status: 200
        });
      }
      if (url.includes(':generateContent')) {
        return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }), {
          status: 200
        });
      }
      if (url.includes('/messages')) {
        return new Response(JSON.stringify({ content: [{ type: 'text', text: 'ok' }] }), {
          status: 200
        });
      }
      if (url.includes('/detect')) {
        return new Response(JSON.stringify({ detections: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: 'not found' }), { status: 404 });
    });

    vi.stubGlobal('fetch', fetchMock);
    const executors = createHttpProviderExecutors({
      llmPrompt: 'return patch-only json',
      visionInput: 'runs/test.png'
    });

    const openai = await executors.executeLlm({
      provider: 'openai',
      apiKey: 'oa-key',
      baseUrl: 'https://api.openai.local/v1',
      model: 'gpt-4.1-mini'
    });
    const gemini = await executors.executeLlm({
      provider: 'gemini',
      apiKey: 'gm-key',
      baseUrl: 'https://gemini.local/v1beta',
      model: 'gemini-2.0-flash'
    });
    const anthropic = await executors.executeLlm({
      provider: 'anthropic',
      apiKey: 'an-key',
      baseUrl: 'https://anthropic.local/v1',
      model: 'claude-3-5-haiku-latest'
    });
    const yolo = await executors.executeVision({
      provider: 'yolo26',
      apiKey: 'yo-key',
      baseUrl: 'https://vision.local',
      model: 'yolo26n'
    });

    expect(openai.ok).toBe(true);
    expect(gemini.ok).toBe(true);
    expect(anthropic.ok).toBe(true);
    expect(yolo.ok).toBe(true);

    expect(calls.some((call) => call.url.includes('/chat/completions'))).toBe(true);
    expect(calls.some((call) => call.url.includes(':generateContent'))).toBe(true);
    expect(calls.some((call) => call.url.includes('/messages'))).toBe(true);
    expect(calls.some((call) => call.url.includes('/detect'))).toBe(true);
  });

  it('supports yolo26 endpoint without authorization header', async () => {
    const calls: Array<{ url: string; headers: Record<string, string> }> = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const headers: Record<string, string> = {};
      if (init?.headers) {
        for (const [key, value] of Object.entries(init.headers as Record<string, string>)) {
          headers[key.toLowerCase()] = String(value);
        }
      }
      calls.push({ url: String(input), headers });
      return new Response(JSON.stringify({ detections: [] }), { status: 200 });
    });

    vi.stubGlobal('fetch', fetchMock);
    const executors = createHttpProviderExecutors({
      llmPrompt: 'ignored',
      visionInput: 'runs/test.png'
    });

    const result = await executors.executeVision({
      provider: 'yolo26',
      baseUrl: 'http://127.0.0.1:8080',
      model: 'yolo26n'
    });

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toContain('/detect');
    expect(calls[0]?.headers.authorization).toBeUndefined();
  });

  it('builds composite vision input when multiple images are provided', async () => {
    const calls: Array<{ body: Record<string, unknown> }> = [];
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {}
      });
      return new Response(JSON.stringify({ detections: [] }), { status: 200 });
    });

    vi.stubGlobal('fetch', fetchMock);
    const compositeCalls: string[][] = [];
    const executors = createHttpProviderExecutors({
      llmPrompt: 'ignored',
      visionInput: ['runs/a.png', 'runs/b.png', 'runs/c.png'],
      createCompositeVisionInput: async (inputPaths) => {
        compositeCalls.push([...inputPaths]);
        return 'runs/composite-items.png';
      }
    });

    const result = await executors.executeVision({
      provider: 'yolo26',
      baseUrl: 'http://127.0.0.1:8080',
      model: 'yolo26n'
    });

    expect(result.ok).toBe(true);
    expect(compositeCalls).toEqual([['runs/a.png', 'runs/b.png', 'runs/c.png']]);
    expect(calls[0]?.body.input).toBe('runs/composite-items.png');
  });
});
