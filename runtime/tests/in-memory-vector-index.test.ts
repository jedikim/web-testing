import { describe, expect, it } from 'vitest';

import { createInMemoryVectorIndex } from '../src/fallback/in-memory-vector-index';

describe('in-memory vector index', () => {
  it('finds nearest vectors with brute-force backend', () => {
    const index = createInMemoryVectorIndex({
      dimension: 2,
      backend: 'bruteforce'
    });
    index.add([
      { id: 'a', vector: [1, 0] },
      { id: 'b', vector: [0.1, 0.9] },
      { id: 'c', vector: [-1, 0] }
    ]);

    const nearest = index.search([0.9, 0.1], 2);
    expect(nearest).toHaveLength(2);
    expect(nearest[0]?.id).toBe('a');
  });

  it('falls back gracefully when hnsw backend is unavailable', () => {
    const index = createInMemoryVectorIndex({
      dimension: 3,
      backend: 'hnsw'
    });

    index.add([
      { id: 'x', vector: [1, 0, 0] },
      { id: 'y', vector: [0, 1, 0] }
    ]);

    const nearest = index.search([0.8, 0.2, 0], 1);
    expect(nearest[0]?.id).toBe('x');
    expect(index.backend === 'hnsw' || index.backend === 'bruteforce').toBe(true);
  });
});

