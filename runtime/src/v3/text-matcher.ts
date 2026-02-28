import type { MatchResult } from './types';

export interface TextMatcherOptions {
  synonyms?: Record<string, string[]>;
  fuzzyThreshold?: number;
}

function normalize(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().toLowerCase();
}

function tokenize(raw: string): string[] {
  const normalized = normalize(raw);
  if (!normalized) {
    return [];
  }
  return Array.from(new Set(normalized.match(/[0-9a-zA-Z가-힣]+/g) ?? []));
}

function stemLike(token: string): string {
  const lowered = token.toLowerCase();
  if (lowered.length <= 3) {
    return lowered;
  }
  return lowered.replace(/(ing|ed|es|s)$/i, '');
}

function levenshteinDistance(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  if (left.length === 0) {
    return right.length;
  }
  if (right.length === 0) {
    return left.length;
  }

  const rows = left.length + 1;
  const cols = right.length + 1;
  const table: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));

  for (let i = 0; i < rows; i += 1) {
    table[i]![0] = i;
  }
  for (let j = 0; j < cols; j += 1) {
    table[0]![j] = j;
  }

  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const replaceCost = left[i - 1] === right[j - 1] ? 0 : 1;
      const insertion = table[i]![j - 1]! + 1;
      const deletion = table[i - 1]![j]! + 1;
      const replace = table[i - 1]![j - 1]! + replaceCost;
      table[i]![j] = Math.min(insertion, deletion, replace);
    }
  }

  return table[rows - 1]![cols - 1]!;
}

function similarity(left: string, right: string): number {
  const maxLength = Math.max(left.length, right.length);
  if (maxLength === 0) {
    return 1;
  }
  const distance = levenshteinDistance(left, right);
  return Math.max(0, 1 - distance / maxLength);
}

export class TextMatcher {
  private readonly synonymIndex: Record<string, string[]>;
  private readonly fuzzyThreshold: number;

  constructor(options: TextMatcherOptions = {}) {
    this.synonymIndex = {};
    const source = options.synonyms ?? {};
    for (const [keyword, values] of Object.entries(source)) {
      const key = normalize(keyword);
      if (!key) {
        continue;
      }
      const normalized = values.map((value) => normalize(value)).filter((value) => value.length > 0);
      this.synonymIndex[key] = Array.from(new Set(normalized));
    }
    this.fuzzyThreshold = options.fuzzyThreshold ?? 0.75;
  }

  match(keyword: string, text: string): MatchResult {
    const normalizedKeyword = normalize(keyword);
    const normalizedText = normalize(text);
    if (!normalizedKeyword || !normalizedText) {
      return { type: 'none', score: 0 };
    }

    if (normalizedKeyword === normalizedText) {
      return { type: 'exact', score: 1.0 };
    }

    if (normalizedText.includes(normalizedKeyword)) {
      return { type: 'phrase', score: 0.9 };
    }

    const keywordTokens = tokenize(normalizedKeyword);
    const textTokens = tokenize(normalizedText);
    if (keywordTokens.length > 0 && textTokens.length > 0) {
      const textTokenSet = new Set(textTokens);
      if (keywordTokens.some((token) => textTokenSet.has(token))) {
        return { type: 'word', score: 0.7 };
      }

      const textStems = new Set(textTokens.map((token) => stemLike(token)));
      if (keywordTokens.some((token) => textStems.has(stemLike(token)))) {
        return { type: 'word', score: 0.7 };
      }
    }

    const synonymKey = normalize(keyword);
    const synonyms = this.synonymIndex[synonymKey] ?? [];
    if (synonyms.length > 0) {
      for (const synonym of synonyms) {
        if (normalizedText.includes(synonym)) {
          return { type: 'synonym', score: 0.6 };
        }
      }
      const textTokenSet = new Set(textTokens);
      for (const synonym of synonyms) {
        const synTokens = tokenize(synonym);
        if (synTokens.some((token) => textTokenSet.has(token))) {
          return { type: 'synonym', score: 0.6 };
        }
      }
    }

    const fuzzyCandidates = [normalizedText, ...textTokens];
    const fuzzyScore = fuzzyCandidates.reduce((best, candidate) => Math.max(best, similarity(normalizedKeyword, candidate)), 0);
    if (fuzzyScore >= this.fuzzyThreshold) {
      return { type: 'fuzzy', score: fuzzyScore * 0.5 };
    }

    return { type: 'none', score: 0 };
  }
}
