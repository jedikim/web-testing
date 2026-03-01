import type { AutomationSession, SessionTurn } from './types';
import { GEMINI_TURN_GUIDANCE_PROMPT_V1 } from '../prompts/gemini-turn-guidance';
import { promptTag } from '../prompts/types';

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

export interface CascadedUncertaintyReport {
  escalate: boolean;
  reason?: string;
  confidence: number;
  sensitive: boolean;
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
    this.model = options.model ?? process.env.BACKEND_AUTOMATION_MODEL ?? 'gemini-3-flash-preview';
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

    const prompt = GEMINI_TURN_GUIDANCE_PROMPT_V1.render({
      sessionMode: input.session.mode,
      conversation,
      userMessage: input.userMessage
    });

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
        model: this.model,
        prompt: promptTag(GEMINI_TURN_GUIDANCE_PROMPT_V1)
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

export interface CascadedTurnEngineOptions {
  primary: MultiTurnEngine;
  escalation: MultiTurnEngine;
  fallback?: MultiTurnEngine;
  uncertaintyThreshold?: number;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }
  return value;
}

function estimateConfidence(output: GenerateTurnOutput): number {
  const metadataConfidence = asNumber((output.metadata as Record<string, unknown> | undefined)?.confidence);
  if (metadataConfidence !== undefined) {
    return Math.max(0, Math.min(1, metadataConfidence));
  }

  const text = output.content.trim();
  if (text.length < 20) {
    return 0.35;
  }
  if (/\b(maybe|uncertain|not sure|확실하지|모르겠)\b/i.test(text)) {
    return 0.45;
  }
  if (text.length >= 80) {
    return 0.85;
  }
  return 0.7;
}

function isSensitiveRequest(message: string): boolean {
  return /(login|로그인|captcha|otp|2fa|payment|결제|password|비밀번호|security)/i.test(message);
}

function needsEscalationForUncertainty(
  input: GenerateTurnInput,
  output: GenerateTurnOutput,
  threshold: number
): CascadedUncertaintyReport {
  const confidence = estimateConfidence(output);
  const sensitive = isSensitiveRequest(input.userMessage);
  if (sensitive) {
    return {
      escalate: true,
      reason: 'sensitive_request',
      confidence,
      sensitive
    };
  }

  if (confidence < threshold) {
    return {
      escalate: true,
      reason: 'low_confidence',
      confidence,
      sensitive
    };
  }

  return {
    escalate: false,
    confidence,
    sensitive
  };
}

function withCascadeMetadata(
  output: GenerateTurnOutput,
  metadata: Record<string, unknown>
): GenerateTurnOutput {
  return {
    ...output,
    metadata: {
      ...(output.metadata ?? {}),
      ...metadata
    }
  };
}

export class CascadedTurnEngine implements MultiTurnEngine {
  private readonly primary: MultiTurnEngine;
  private readonly escalation: MultiTurnEngine;
  private readonly fallback: MultiTurnEngine;
  private readonly uncertaintyThreshold: number;

  constructor(options: CascadedTurnEngineOptions) {
    this.primary = options.primary;
    this.escalation = options.escalation;
    this.fallback = options.fallback ?? new RuleBasedTurnEngine();
    this.uncertaintyThreshold = Math.min(1, Math.max(0, options.uncertaintyThreshold ?? 0.65));
  }

  private async runEscalation(
    input: GenerateTurnInput,
    reason: string
  ): Promise<GenerateTurnOutput> {
    const escalated = await this.escalation.generate(input);
    return withCascadeMetadata(escalated, {
      cascadeTier: 'pro',
      escalated: true,
      escalationReason: reason
    });
  }

  async generate(input: GenerateTurnInput): Promise<GenerateTurnOutput> {
    try {
      const primary = await this.primary.generate(input);
      const assessment = needsEscalationForUncertainty(
        input,
        primary,
        this.uncertaintyThreshold
      );

      if (!assessment.escalate) {
        return withCascadeMetadata(primary, {
          cascadeTier: 'flash',
          escalated: false,
          confidence: assessment.confidence,
          sensitive: assessment.sensitive
        });
      }

      try {
        return await this.runEscalation(input, assessment.reason ?? 'uncertain');
      } catch {
        const fallback = await this.fallback.generate(input);
        return withCascadeMetadata(fallback, {
          cascadeTier: 'rule_fallback',
          escalated: true,
          escalationReason: assessment.reason ?? 'uncertain',
          fallbackReason: 'escalation_failed'
        });
      }
    } catch {
      try {
        return await this.runEscalation(input, 'flash_failed');
      } catch {
        const fallback = await this.fallback.generate(input);
        return withCascadeMetadata(fallback, {
          cascadeTier: 'rule_fallback',
          escalated: true,
          escalationReason: 'flash_failed',
          fallbackReason: 'flash_and_escalation_failed'
        });
      }
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

  const thresholdRaw = process.env.BACKEND_CASCADE_THRESHOLD;
  const thresholdParsed = thresholdRaw ? Number(thresholdRaw) : undefined;
  const uncertaintyThreshold = Number.isFinite(thresholdParsed ?? Number.NaN)
    ? thresholdParsed
    : undefined;

  return new CascadedTurnEngine({
    primary: new GeminiTurnEngine({
      model: process.env.BACKEND_AUTOMATION_MODEL ?? 'gemini-3-flash-preview'
    }),
    escalation: new GeminiTurnEngine({
      model: process.env.BACKEND_CASCADE_ESCALATION_MODEL ?? 'gemini-3.1-pro-preview'
    }),
    fallback: new RuleBasedTurnEngine(),
    uncertaintyThreshold
  });
}
