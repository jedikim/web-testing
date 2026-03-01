import { createRequire } from 'node:module';

export type VectorBackend = 'auto' | 'hnsw' | 'bruteforce';
export type VectorBackendUsed = 'hnsw' | 'bruteforce';

export interface VectorRecord {
  id: string;
  vector: number[];
}

export interface VectorSearchResult {
  id: string;
  score: number;
}

export interface InMemoryVectorIndex {
  backend: VectorBackendUsed;
  size(): number;
  add(items: VectorRecord[]): void;
  search(query: number[], limit: number): VectorSearchResult[];
}

export interface CreateInMemoryVectorIndexInput {
  dimension: number;
  backend?: VectorBackend;
}

function ensureFiniteVector(vector: number[], dimension: number): void {
  if (vector.length !== dimension) {
    throw new Error(`vector dimension mismatch: expected=${dimension} actual=${vector.length}`);
  }
  for (const value of vector) {
    if (!Number.isFinite(value)) {
      throw new Error('vector contains non-finite value');
    }
  }
}

function l2Norm(vector: number[]): number {
  let sum = 0;
  for (const value of vector) {
    sum += value * value;
  }
  return Math.sqrt(sum);
}

function cosineSimilarity(left: number[], right: number[]): number {
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let i = 0; i < left.length; i += 1) {
    const a = left[i] ?? 0;
    const b = right[i] ?? 0;
    dot += a * b;
    leftNorm += a * a;
    rightNorm += b * b;
  }
  const denominator = Math.sqrt(leftNorm) * Math.sqrt(rightNorm);
  if (denominator <= Number.EPSILON) {
    return 0;
  }
  return dot / denominator;
}

class BruteForceVectorIndex implements InMemoryVectorIndex {
  readonly backend: VectorBackendUsed = 'bruteforce';
  private readonly dimension: number;
  private readonly rows: Array<{ id: string; vector: number[] }> = [];

  constructor(dimension: number) {
    this.dimension = dimension;
  }

  size(): number {
    return this.rows.length;
  }

  add(items: VectorRecord[]): void {
    for (const item of items) {
      ensureFiniteVector(item.vector, this.dimension);
      this.rows.push({
        id: item.id,
        vector: [...item.vector]
      });
    }
  }

  search(query: number[], limit: number): VectorSearchResult[] {
    ensureFiniteVector(query, this.dimension);
    const topK = Math.max(1, Math.floor(limit));
    return [...this.rows]
      .map((row) => ({
        id: row.id,
        score: cosineSimilarity(query, row.vector)
      }))
      .sort((left, right) => right.score - left.score)
      .slice(0, topK);
  }
}

function resolveNeighbors(raw: unknown): number[] {
  if (!raw || typeof raw !== 'object') {
    return [];
  }
  const record = raw as Record<string, unknown>;
  const candidates = [record.neighbors, record.neighbours, record.ids];
  for (const entry of candidates) {
    if (Array.isArray(entry)) {
      return entry.filter((value): value is number => typeof value === 'number');
    }
  }
  return [];
}

function resolveDistances(raw: unknown): number[] {
  if (!raw || typeof raw !== 'object') {
    return [];
  }
  const record = raw as Record<string, unknown>;
  const candidates = [record.distances, record.distance];
  for (const entry of candidates) {
    if (Array.isArray(entry)) {
      return entry.filter((value): value is number => typeof value === 'number');
    }
  }
  return [];
}

class HnswVectorIndex implements InMemoryVectorIndex {
  readonly backend: VectorBackendUsed = 'hnsw';
  private readonly dimension: number;
  private readonly index: any;
  private readonly labels: string[] = [];
  private capacity: number;

  constructor(dimension: number, HierarchicalNSW: new (space: string, dim: number) => any) {
    this.dimension = dimension;
    this.capacity = 256;
    this.index = new HierarchicalNSW('cosine', dimension);
    this.index.initIndex(this.capacity);
  }

  size(): number {
    return this.labels.length;
  }

  private ensureCapacity(nextCount: number): void {
    if (nextCount <= this.capacity) {
      return;
    }
    while (this.capacity < nextCount) {
      this.capacity *= 2;
    }
    if (typeof this.index.resizeIndex === 'function') {
      this.index.resizeIndex(this.capacity);
      return;
    }
    throw new Error('hnsw backend does not support dynamic resize');
  }

  add(items: VectorRecord[]): void {
    this.ensureCapacity(this.labels.length + items.length);
    for (const item of items) {
      ensureFiniteVector(item.vector, this.dimension);
      const label = this.labels.length;
      this.labels.push(item.id);
      this.index.addPoint(item.vector, label);
    }
  }

  search(query: number[], limit: number): VectorSearchResult[] {
    ensureFiniteVector(query, this.dimension);
    const topK = Math.min(Math.max(1, Math.floor(limit)), Math.max(1, this.labels.length));
    if (this.labels.length === 0) {
      return [];
    }
    const raw = this.index.searchKnn(query, topK);
    const neighbors = resolveNeighbors(raw);
    const distances = resolveDistances(raw);
    return neighbors.map((label, index) => {
      const id = this.labels[label] ?? `label-${label}`;
      const distance = distances[index] ?? 1;
      const similarity = Number.isFinite(distance) ? 1 - distance : 0;
      return {
        id,
        score: similarity
      };
    });
  }
}

function tryCreateHnswVectorIndex(dimension: number): InMemoryVectorIndex | undefined {
  try {
    const require = createRequire(import.meta.url);
    const module = require('hnswlib-node') as Record<string, unknown>;
    const HierarchicalNSW = (module.HierarchicalNSW ??
      (module.default as Record<string, unknown> | undefined)?.HierarchicalNSW) as
      | (new (space: string, dim: number) => any)
      | undefined;
    if (!HierarchicalNSW) {
      return undefined;
    }
    return new HnswVectorIndex(dimension, HierarchicalNSW);
  } catch {
    return undefined;
  }
}

export function createInMemoryVectorIndex(input: CreateInMemoryVectorIndexInput): InMemoryVectorIndex {
  const dimension = Math.max(1, Math.floor(input.dimension));
  const backend = input.backend ?? 'auto';

  if (backend === 'bruteforce') {
    return new BruteForceVectorIndex(dimension);
  }

  const hnswIndex = tryCreateHnswVectorIndex(dimension);
  if (hnswIndex) {
    return hnswIndex;
  }

  return new BruteForceVectorIndex(dimension);
}

export function normalizeVector(vector: number[]): number[] {
  const norm = l2Norm(vector);
  if (norm <= Number.EPSILON) {
    return vector.map(() => 0);
  }
  return vector.map((value) => value / norm);
}

