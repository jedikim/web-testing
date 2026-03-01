import {
  createInMemoryVectorIndex,
  normalizeVector,
  type VectorBackend,
  type VectorBackendUsed
} from './in-memory-vector-index';

export interface CandidateItem {
  id: string;
  role: string;
  text: string;
  score: number;
  bbox: [number, number, number, number];
  attributes?: Record<string, string>;
}

export interface ReducedCandidate {
  id: string;
  role: string;
  text: string;
  score: number;
  bbox: [number, number, number, number];
}

export type CandidateIntent =
  | 'generic'
  | 'navigation'
  | 'menu'
  | 'login'
  | 'search'
  | 'settings';

export interface CandidateContextMetadata {
  strategy: 'score_only' | 'structure_first' | 'structure_plus_semantic';
  intent: CandidateIntent;
  query?: string;
  totalCandidates: number;
  structureFirstPoolSize: number;
  returnedCandidates: number;
  vectorBackend?: VectorBackendUsed;
  embeddedCandidateCount?: number;
  embeddedTotalCount?: number;
  semanticRerankSkipped?: string;
}

export interface CandidateContext {
  candidates: ReducedCandidate[];
  metadata?: CandidateContextMetadata;
}

export interface CandidateEmbeddingCache {
  get(pageKey: string, signature: string): number[] | undefined;
  set(pageKey: string, signature: string, vector: number[]): void;
  clear(pageKey?: string): void;
}

export class PageScopedEmbeddingCache implements CandidateEmbeddingCache {
  private readonly pages = new Map<string, Map<string, number[]>>();

  get(pageKey: string, signature: string): number[] | undefined {
    const page = this.pages.get(pageKey);
    if (!page) {
      return undefined;
    }
    const vector = page.get(signature);
    return vector ? [...vector] : undefined;
  }

  set(pageKey: string, signature: string, vector: number[]): void {
    const page = this.pages.get(pageKey) ?? new Map<string, number[]>();
    page.set(signature, [...vector]);
    this.pages.set(pageKey, page);
  }

  clear(pageKey?: string): void {
    if (!pageKey) {
      this.pages.clear();
      return;
    }
    this.pages.delete(pageKey);
  }
}

export interface SemanticRerankOptions {
  query: string;
  embed: (texts: string[]) => Promise<number[][]>;
  topK?: number;
  vectorBackend?: VectorBackend;
  pageKey?: string;
  cache?: CandidateEmbeddingCache;
}

export interface BuildCandidateContextOptions {
  maxCandidates?: number;
  structureFirstLimit?: number;
  intent?: CandidateIntent;
  query?: string;
  semanticRerank?: SemanticRerankOptions;
}

interface NormalizedBuildOptions {
  maxCandidates: number;
  structureFirstLimit: number;
  intent: CandidateIntent;
  query?: string;
  semanticRerank?: SemanticRerankOptions;
}

interface StructuralReductionResult {
  pool: CandidateItem[];
  selected: CandidateItem[];
  metadata: CandidateContextMetadata;
}

const DEFAULT_MAX_CANDIDATES = 8;
const DEFAULT_STRUCTURE_FIRST_LIMIT = 40;
const DEFAULT_EMBEDDING_CACHE = new PageScopedEmbeddingCache();

function asFinite(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return value as number;
}

function normalizeText(raw: string | undefined): string {
  return (raw ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function tokenize(raw: string | undefined): string[] {
  const text = normalizeText(raw);
  if (!text) {
    return [];
  }
  return Array.from(
    new Set(text.split(/[^0-9a-zA-Z가-힣]+/).map((value) => value.trim()).filter((value) => value.length > 0))
  );
}

function jaccard(left: string[], right: string[]): number {
  if (left.length === 0 && right.length === 0) {
    return 1;
  }
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  const intersection = [...leftSet].filter((value) => rightSet.has(value)).length;
  const union = new Set([...leftSet, ...rightSet]).size;
  if (union === 0) {
    return 0;
  }
  return intersection / union;
}

function topRegionBias(y: number): number {
  if (!Number.isFinite(y)) {
    return 0;
  }
  if (y >= 0 && y <= 1) {
    return Math.max(0, 1 - y);
  }
  if (y > 1) {
    return Math.max(0, 1 - y / 1800);
  }
  return 0;
}

function firstNonEmpty(...values: Array<string | undefined>): string {
  for (const value of values) {
    const normalized = normalizeText(value);
    if (normalized.length > 0) {
      return normalized;
    }
  }
  return '';
}

function inferIntentFromQuery(query: string | undefined): CandidateIntent {
  const normalized = normalizeText(query);
  if (!normalized) {
    return 'generic';
  }
  if (/(menu|메뉴|navigation|네비|햄버거|전체\s*메뉴)/i.test(normalized)) {
    return 'menu';
  }
  if (/(login|signin|sign in|로그인|회원\s*가입|인증)/i.test(normalized)) {
    return 'login';
  }
  if (/(search|검색|query|찾기)/i.test(normalized)) {
    return 'search';
  }
  if (/(setting|환경설정|설정|preferences|profile)/i.test(normalized)) {
    return 'settings';
  }
  if (/(nav|navigation|헤더|상단)/i.test(normalized)) {
    return 'navigation';
  }
  return 'generic';
}

function maxCandidateCount(input: number | undefined): number {
  if (!Number.isFinite(input)) {
    return DEFAULT_MAX_CANDIDATES;
  }
  return Math.max(1, Math.floor(input as number));
}

function normalizeBuildOptions(input?: number | BuildCandidateContextOptions): NormalizedBuildOptions {
  if (typeof input === 'number') {
    return {
      maxCandidates: maxCandidateCount(input),
      structureFirstLimit: Math.max(DEFAULT_STRUCTURE_FIRST_LIMIT, maxCandidateCount(input)),
      intent: 'generic'
    };
  }

  const maxCandidates = maxCandidateCount(input?.maxCandidates);
  const structureFirstLimit = Math.max(
    maxCandidates,
    maxCandidateCount(input?.structureFirstLimit ?? DEFAULT_STRUCTURE_FIRST_LIMIT)
  );
  const query = normalizeText(input?.query);
  const intent = input?.intent ?? inferIntentFromQuery(query);
  return {
    maxCandidates,
    structureFirstLimit,
    intent,
    query: query.length > 0 ? query : undefined,
    semanticRerank: input?.semanticRerank
  };
}

function makeCandidateAttributesText(candidate: CandidateItem): string {
  const attributes = candidate.attributes ?? {};
  const keys = [
    'id',
    'name',
    'class',
    'className',
    'aria-label',
    'ariaLabel',
    'aria-expanded',
    'ariaExpanded',
    'placeholder',
    'href',
    'tag',
    'tagName',
    'type',
    'region',
    'landmark',
    'nearbyText'
  ];
  const parts: string[] = [];
  for (const key of keys) {
    const value = attributes[key];
    if (value && value.trim().length > 0) {
      parts.push(value.trim());
    }
  }
  return parts.join(' ');
}

function scoreByStructure(candidate: CandidateItem, intent: CandidateIntent, query?: string): number {
  const attributes = candidate.attributes ?? {};
  const role = firstNonEmpty(candidate.role, attributes.role);
  const text = firstNonEmpty(candidate.text, attributes['aria-label'], attributes.placeholder);
  const tag = firstNonEmpty(attributes.tag, attributes.tagName);
  const className = firstNonEmpty(attributes.class, attributes.className);
  const href = firstNonEmpty(attributes.href);
  const ariaExpanded = firstNonEmpty(attributes['aria-expanded'], attributes.ariaExpanded);
  const type = firstNonEmpty(attributes.type);
  const nearby = firstNonEmpty(attributes.nearbyText);
  const region = firstNonEmpty(attributes.region, attributes.landmark);

  let bonus = 0;

  if (tag === 'nav' || role.includes('navigation') || region.includes('header')) {
    bonus += 0.9;
  }
  if (tag === 'button' || role.includes('button') || role.includes('link') || tag === 'a' || href.length > 0) {
    bonus += 0.35;
  }
  if (topRegionBias(candidate.bbox[1]) > 0) {
    bonus += topRegionBias(candidate.bbox[1]) * 0.25;
  }

  if (intent === 'menu' || intent === 'navigation') {
    if (/menu|메뉴|전체|category|카테고리|hamburger|네비/.test(`${text} ${className}`)) {
      bonus += 1.2;
    }
    if (ariaExpanded === 'true' || ariaExpanded === 'false') {
      bonus += 0.6;
    }
    if (tag === 'nav' || role.includes('navigation')) {
      bonus += 0.8;
    }
  }

  if (intent === 'login') {
    if (/login|sign in|로그인|회원/.test(`${text} ${className} ${nearby}`)) {
      bonus += 1.4;
    }
    if (role.includes('button') || tag === 'button' || tag === 'a') {
      bonus += 0.4;
    }
  }

  if (intent === 'search') {
    if (/search|검색|query/.test(`${text} ${className} ${nearby}`)) {
      bonus += 1.3;
    }
    if (role.includes('textbox') || role.includes('searchbox') || tag === 'input') {
      bonus += 0.9;
    }
    if (type === 'search' || type === 'text') {
      bonus += 0.55;
    }
  }

  if (intent === 'settings') {
    if (/setting|설정|preferences|profile|계정/.test(`${text} ${className} ${nearby}`)) {
      bonus += 1.2;
    }
  }

  const queryTokens = tokenize(query);
  if (queryTokens.length > 0) {
    const candidateTokens = tokenize(
      `${candidate.text} ${candidate.role} ${makeCandidateAttributesText(candidate)}`
    );
    bonus += jaccard(queryTokens, candidateTokens) * 1.35;
  }

  return asFinite(candidate.score) * 0.55 + bonus;
}

function reduceStructurally(items: CandidateItem[], options: NormalizedBuildOptions): StructuralReductionResult {
  const ranked = [...items]
    .map((item, index) => ({
      item,
      index,
      rankScore: scoreByStructure(item, options.intent, options.query)
    }))
    .sort((left, right) => {
      if (right.rankScore !== left.rankScore) {
        return right.rankScore - left.rankScore;
      }
      if (right.item.score !== left.item.score) {
        return right.item.score - left.item.score;
      }
      return left.index - right.index;
    });

  const pool = ranked.slice(0, options.structureFirstLimit).map((row) => row.item);
  const selected = pool.slice(0, options.maxCandidates);

  return {
    pool,
    selected,
    metadata: {
      strategy: options.query ? 'structure_first' : 'score_only',
      intent: options.intent,
      query: options.query,
      totalCandidates: items.length,
      structureFirstPoolSize: pool.length,
      returnedCandidates: selected.length
    }
  };
}

function toReducedCandidates(items: CandidateItem[]): ReducedCandidate[] {
  return items.map((item) => ({
    id: item.id,
    role: item.role,
    text: item.text,
    score: item.score,
    bbox: item.bbox
  }));
}

function candidateSignature(candidate: CandidateItem): string {
  const attributes = candidate.attributes ?? {};
  const normalizedAttributes = Object.keys(attributes)
    .sort()
    .map((key) => `${key}:${attributes[key] ?? ''}`)
    .join('|');
  return `${candidate.id}::${candidate.role}::${candidate.text}::${normalizedAttributes}`;
}

function candidateEmbeddingText(candidate: CandidateItem): string {
  const attributes = makeCandidateAttributesText(candidate);
  return [
    `role:${candidate.role}`,
    `text:${candidate.text}`,
    attributes.length > 0 ? `attrs:${attributes}` : ''
  ]
    .filter((value) => value.length > 0)
    .join(' ');
}

function normalizeEmbeddingVectors(vectors: number[][]): number[][] {
  return vectors.map((vector) => normalizeVector(vector));
}

function validateEmbeddingOutput(input: {
  vectors: number[][];
  expectedLength: number;
}): void {
  if (input.vectors.length !== input.expectedLength) {
    throw new Error(
      `embedding output length mismatch: expected=${input.expectedLength} actual=${input.vectors.length}`
    );
  }
  for (const vector of input.vectors) {
    if (!Array.isArray(vector) || vector.length === 0) {
      throw new Error('embedding output vector is empty');
    }
    for (const value of vector) {
      if (!Number.isFinite(value)) {
        throw new Error('embedding output contains non-finite value');
      }
    }
  }
}

function safePageKey(raw: string | undefined): string {
  const normalized = normalizeText(raw);
  return normalized.length > 0 ? normalized : 'page:default';
}

export function buildCandidateContext(
  items: CandidateItem[],
  maxCandidatesOrOptions: number | BuildCandidateContextOptions = DEFAULT_MAX_CANDIDATES
): CandidateContext {
  const options = normalizeBuildOptions(maxCandidatesOrOptions);
  const reduced = reduceStructurally(items, options);
  return {
    candidates: toReducedCandidates(reduced.selected),
    metadata: reduced.metadata
  };
}

export async function buildCandidateContextWithSemanticRerank(
  items: CandidateItem[],
  optionsInput: BuildCandidateContextOptions = {}
): Promise<CandidateContext> {
  const options = normalizeBuildOptions(optionsInput);
  const reduced = reduceStructurally(items, options);
  const semantic = options.semanticRerank;
  if (!semantic || !semantic.query || semantic.query.trim().length === 0) {
    return {
      candidates: toReducedCandidates(reduced.selected),
      metadata: reduced.metadata
    };
  }
  if (reduced.pool.length === 0) {
    return {
      candidates: [],
      metadata: {
        ...reduced.metadata,
        strategy: 'structure_plus_semantic',
        semanticRerankSkipped: 'candidate pool is empty'
      }
    };
  }

  try {
    const pageKey = safePageKey(semantic.pageKey);
    const cache = semantic.cache ?? DEFAULT_EMBEDDING_CACHE;

    const queryCacheKey = `query::${normalizeText(semantic.query)}`;
    const queryVectorFromCache = cache.get(pageKey, queryCacheKey);

    const candidateRows = reduced.pool.map((candidate, index) => ({
      recordId: `${candidate.id}::${index}`,
      candidate,
      signature: `candidate::${candidateSignature(candidate)}`
    }));

    const pendingTexts: string[] = [];
    const pendingKeys: string[] = [];
    const vectorByKey = new Map<string, number[]>();
    let embeddedCandidateCount = 0;

    if (!queryVectorFromCache) {
      pendingTexts.push(semantic.query);
      pendingKeys.push(queryCacheKey);
    } else {
      vectorByKey.set(queryCacheKey, queryVectorFromCache);
    }

    for (const row of candidateRows) {
      const cached = cache.get(pageKey, row.signature);
      if (cached) {
        vectorByKey.set(row.signature, cached);
        continue;
      }
      pendingTexts.push(candidateEmbeddingText(row.candidate));
      pendingKeys.push(row.signature);
      embeddedCandidateCount += 1;
    }

    if (pendingTexts.length > 0) {
      const embedded = await semantic.embed(pendingTexts);
      validateEmbeddingOutput({
        vectors: embedded,
        expectedLength: pendingTexts.length
      });
      const normalizedVectors = normalizeEmbeddingVectors(embedded);
      for (let i = 0; i < normalizedVectors.length; i += 1) {
        const key = pendingKeys[i];
        const vector = normalizedVectors[i];
        if (!key || !vector) {
          continue;
        }
        cache.set(pageKey, key, vector);
        vectorByKey.set(key, vector);
      }
    }

    const queryVector = vectorByKey.get(queryCacheKey);
    if (!queryVector) {
      return {
        candidates: toReducedCandidates(reduced.selected),
        metadata: {
          ...reduced.metadata,
          semanticRerankSkipped: 'query vector is unavailable'
        }
      };
    }

    const validRows: Array<{
      recordId: string;
      candidate: CandidateItem;
      vector: number[];
      structuralRank: number;
    }> = [];
    for (let index = 0; index < candidateRows.length; index += 1) {
      const row = candidateRows[index];
      if (!row) {
        continue;
      }
      const vector = vectorByKey.get(row.signature);
      if (!vector || vector.length !== queryVector.length) {
        continue;
      }
      validRows.push({
        recordId: row.recordId,
        candidate: row.candidate,
        vector,
        structuralRank: 1 - index / Math.max(1, candidateRows.length)
      });
    }

    if (validRows.length === 0) {
      return {
        candidates: toReducedCandidates(reduced.selected),
        metadata: {
          ...reduced.metadata,
          semanticRerankSkipped: 'no valid candidate vectors'
        }
      };
    }

    const index = createInMemoryVectorIndex({
      dimension: queryVector.length,
      backend: semantic.vectorBackend ?? 'auto'
    });
    index.add(
      validRows.map((row) => ({
        id: row.recordId,
        vector: row.vector
      }))
    );

    const topK = Math.min(
      Math.max(1, Math.floor(semantic.topK ?? options.maxCandidates)),
      validRows.length
    );
    const found = index.search(queryVector, topK);
    const rowById = new Map(validRows.map((row) => [row.recordId, row]));
    const combined = found
      .map((hit) => {
        const row = rowById.get(hit.id);
        if (!row) {
          return undefined;
        }
        const semanticScore = Math.max(0, Math.min(1, (hit.score + 1) / 2));
        const combinedScore = semanticScore * 0.75 + row.structuralRank * 0.25;
        return {
          row,
          combinedScore
        };
      })
      .filter((entry): entry is { row: (typeof validRows)[number]; combinedScore: number } => Boolean(entry))
      .sort((left, right) => right.combinedScore - left.combinedScore);

    const selected = combined.slice(0, options.maxCandidates).map((entry) => entry.row.candidate);
    if (selected.length === 0) {
      return {
        candidates: toReducedCandidates(reduced.selected),
        metadata: {
          ...reduced.metadata,
          semanticRerankSkipped: 'semantic ranking returned no candidates'
        }
      };
    }

    return {
      candidates: toReducedCandidates(selected),
      metadata: {
        strategy: 'structure_plus_semantic',
        intent: options.intent,
        query: semantic.query,
        totalCandidates: items.length,
        structureFirstPoolSize: reduced.pool.length,
        returnedCandidates: selected.length,
        vectorBackend: index.backend,
        embeddedCandidateCount,
        embeddedTotalCount: pendingTexts.length
      }
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      candidates: toReducedCandidates(reduced.selected),
      metadata: {
        ...reduced.metadata,
        semanticRerankSkipped: message
      }
    };
  }
}

