import { normalizeVector } from './in-memory-vector-index';

export interface LocalSemanticEmbedOptions {
  dimensions?: number;
  maxTokenLength?: number;
}

const DEFAULT_DIMENSIONS = 192;
const DEFAULT_MAX_TOKEN_LENGTH = 64;

function normalizeText(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().toLowerCase();
}

function tokenize(raw: string, maxTokenLength: number): string[] {
  const normalized = normalizeText(raw);
  if (!normalized) {
    return [];
  }
  return Array.from(
    new Set(
      (normalized.match(/[0-9a-zA-Z가-힣]+/g) ?? [])
        .map((token) => token.slice(0, maxTokenLength))
        .filter((token) => token.length > 0)
    )
  );
}

function hashToken(token: string): number {
  let hash = 2166136261;
  for (let index = 0; index < token.length; index += 1) {
    hash ^= token.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function embedTextLocally(text: string, options: LocalSemanticEmbedOptions = {}): number[] {
  const dimensions = Math.max(16, Math.floor(options.dimensions ?? DEFAULT_DIMENSIONS));
  const maxTokenLength = Math.max(8, Math.floor(options.maxTokenLength ?? DEFAULT_MAX_TOKEN_LENGTH));
  const vector = new Array<number>(dimensions).fill(0);

  const tokens = tokenize(text, maxTokenLength);
  if (tokens.length === 0) {
    return vector;
  }

  for (const token of tokens) {
    const hash = hashToken(token);
    const index = hash % dimensions;
    const sign = (hash & 1) === 0 ? 1 : -1;
    const lengthWeight = Math.min(2.5, 1 + token.length / 12);
    vector[index] = (vector[index] ?? 0) + sign * lengthWeight;
  }

  return normalizeVector(vector);
}

export async function embedTextsLocally(
  texts: string[],
  options: LocalSemanticEmbedOptions = {}
): Promise<number[][]> {
  return texts.map((text) => embedTextLocally(text, options));
}

