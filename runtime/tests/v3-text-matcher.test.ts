import { describe, expect, it } from 'vitest';

import { TextMatcher } from '../src/v3/text-matcher';

describe('TextMatcher', () => {
  it('returns exact for exact match', () => {
    const matcher = new TextMatcher();
    const result = matcher.match('검색', '검색');
    expect(result.type).toBe('exact');
    expect(result.score).toBeCloseTo(1.0, 4);
  });

  it('returns phrase for substring match', () => {
    const matcher = new TextMatcher();
    const result = matcher.match('sports', 'women sports wear');
    expect(result.type).toBe('phrase');
    expect(result.score).toBeGreaterThan(0.8);
  });

  it('returns synonym when configured', () => {
    const matcher = new TextMatcher({
      synonyms: {
        검색창: ['검색', 'search', 'search box']
      }
    });
    const result = matcher.match('검색창', '통합검색');
    expect(result.type).toBe('synonym');
    expect(result.score).toBeGreaterThan(0.5);
  });

  it('returns fuzzy for typo-like match', () => {
    const matcher = new TextMatcher();
    const result = matcher.match('seach', 'search');
    expect(result.type).toBe('fuzzy');
    expect(result.score).toBeGreaterThan(0.3);
  });
});
