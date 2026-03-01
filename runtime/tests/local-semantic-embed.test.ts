import { describe, expect, it } from 'vitest';

import { embedTextLocally, embedTextsLocally } from '../src/fallback/local-semantic-embed';

describe('local semantic embed', () => {
  it('returns deterministic vector for same text', () => {
    const first = embedTextLocally('여성 등산복 레드 10만원 이하');
    const second = embedTextLocally('여성 등산복 레드 10만원 이하');
    expect(first).toEqual(second);
    expect(first.length).toBe(192);
  });

  it('returns normalized vectors with finite values', () => {
    const vector = embedTextLocally('search input login menu');
    const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
    expect(Number.isFinite(norm)).toBe(true);
    expect(norm).toBeGreaterThan(0.9);
    expect(norm).toBeLessThan(1.1);
  });

  it('supports async batch embedding', async () => {
    const rows = await embedTextsLocally(['login button', 'search input']);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.length).toBe(192);
    expect(rows[1]?.length).toBe(192);
  });
});

