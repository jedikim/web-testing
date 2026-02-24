import type { AutomationSession, SessionTurn } from './types';

export interface GenerateTurnInput {
  session: AutomationSession;
  userMessage: string;
}

export interface GenerateTurnOutput {
  content: string;
  metadata?: Record<string, unknown>;
}

export interface MultiTurnEngine {
  generate(input: GenerateTurnInput): Promise<GenerateTurnOutput>;
}

function recentTurns(turns: SessionTurn[], count = 6): SessionTurn[] {
  return turns.slice(Math.max(0, turns.length - count));
}

export class RuleBasedTurnEngine implements MultiTurnEngine {
  async generate(input: GenerateTurnInput): Promise<GenerateTurnOutput> {
    const lowered = input.userMessage.toLowerCase();

    if (lowered.includes('run') || lowered.includes('실행')) {
      return {
        content:
          'Recommended next step: run deterministic workflow first, capture screenshot, then verify outcome before escalation.',
        metadata: {
          intent: 'execution'
        }
      };
    }

    if (lowered.includes('error') || lowered.includes('fail') || lowered.includes('실패')) {
      return {
        content:
          'Failure handling plan: classify failure code -> selector/vision recovery -> checkpoint decision -> trigger evolution only if unresolved.',
        metadata: {
          intent: 'failure_triage'
        }
      };
    }

    const turns = recentTurns(input.session.turns).map((turn) => `${turn.role}: ${turn.content}`);
    return {
      content: [
        'Session summary acknowledged.',
        'Next action: provide target URL + expected result + stop condition.',
        'Recent context:',
        ...turns
      ].join('\n')
    };
  }
}

export interface GeminiTurnEngineOptions {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  timeoutMs?: number;
}

function optionalTrim(raw: string | undefined): string | undefined {
  if (!raw) {
    return undefined;
  }
  const value = raw.trim();
  return value.length > 0 ? value : undefined;
}

function extractGeminiText(payload: unknown): string {
  if (!payload || typeof payload !== 'object') {
    return '';
  }

  const candidates = (payload as Record<string, unknown>).candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return '';
  }

  const content = (candidates[0] as Record<string, unknown>).content as Record<string, unknown>;
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
    .join('\n')
    .trim();
}

export class GeminiTurnEngine implements MultiTurnEngine {
  private readonly apiKey?: string;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(options: GeminiTurnEngineOptions = {}) {
    this.apiKey = optionalTrim(options.apiKey) ?? optionalTrim(process.env.GEMINI_API_KEY);
    this.model = options.model ?? process.env.BACKEND_AUTOMATION_MODEL ?? 'gemini-3.0-flash';
    this.baseUrl = options.baseUrl ?? process.env.GEMINI_BASE_URL ?? 'https://generativelanguage.googleapis.com/v1beta';
    this.timeoutMs = options.timeoutMs ?? 60_000;
  }

  async generate(input: GenerateTurnInput): Promise<GenerateTurnOutput> {
    if (!this.apiKey) {
      throw new Error('GEMINI_API_KEY is required for GeminiTurnEngine');
    }

    const conversation = input.session.turns
      .slice(-12)
      .map((turn) => `${turn.role}: ${turn.content}`)
      .join('\n');

    const prompt = [
      'You are an automation co-pilot for web tasks.',
      'Respond with concise next-step guidance.',
      `Session mode: ${input.session.mode}`,
      'Conversation so far:',
      conversation,
      '',
      `Latest user message: ${input.userMessage}`
    ].join('\n');

    const endpoint = `${this.baseUrl}/models/${this.model}:generateContent?key=${this.apiKey}`;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [{ text: prompt }]
          }
        ],
        generationConfig: {
          temperature: 0.2
        }
      }),
      signal: AbortSignal.timeout(this.timeoutMs)
    });

    if (!response.ok) {
      throw new Error(`gemini request failed: ${response.status}`);
    }

    const payload = (await response.json()) as unknown;
    const text = extractGeminiText(payload);
    if (!text) {
      throw new Error('gemini returned empty content');
    }

    return {
      content: text,
      metadata: {
        provider: 'gemini',
        model: this.model
      }
    };
  }
}

export interface HybridTurnEngineOptions {
  primary: MultiTurnEngine;
  fallback?: MultiTurnEngine;
}

export class HybridTurnEngine implements MultiTurnEngine {
  private readonly primary: MultiTurnEngine;
  private readonly fallback: MultiTurnEngine;

  constructor(options: HybridTurnEngineOptions) {
    this.primary = options.primary;
    this.fallback = options.fallback ?? new RuleBasedTurnEngine();
  }

  async generate(input: GenerateTurnInput): Promise<GenerateTurnOutput> {
    try {
      return await this.primary.generate(input);
    } catch {
      return this.fallback.generate(input);
    }
  }
}

export interface BuildDefaultTurnEngineOptions {
  useGemini?: boolean;
}

export function buildDefaultTurnEngine(
  options: BuildDefaultTurnEngineOptions = {}
): MultiTurnEngine {
  const useGemini = options.useGemini ?? process.env.BACKEND_LLM_ENABLED === '1';
  if (!useGemini) {
    return new RuleBasedTurnEngine();
  }

  return new HybridTurnEngine({
    primary: new GeminiTurnEngine(),
    fallback: new RuleBasedTurnEngine()
  });
}
