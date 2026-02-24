import { describe, expect, it } from 'vitest';

import { buildCandidateContext, type CandidateItem } from '../src/fallback/context-reducer';

describe('buildCandidateContext', () => {
  it('sorts candidates by score and limits count', () => {
    const items: CandidateItem[] = [
      {
        id: 'a',
        role: 'button',
        text: 'A',
        score: 0.1,
        bbox: [0, 0, 10, 10]
      },
      {
        id: 'b',
        role: 'button',
        text: 'B',
        score: 0.9,
        bbox: [0, 0, 20, 20]
      },
      {
        id: 'c',
        role: 'button',
        text: 'C',
        score: 0.5,
        bbox: [0, 0, 30, 30]
      }
    ];

    const context = buildCandidateContext(items, 2);
    expect(context.candidates.map((x) => x.id)).toEqual(['b', 'c']);
  });

  it('drops heavy attributes not needed for selector selection', () => {
    const items: CandidateItem[] = [
      {
        id: 'n1',
        role: 'textbox',
        text: 'Search',
        score: 0.8,
        bbox: [1, 2, 3, 4],
        attributes: { html: '<input ...>' }
      }
    ];

    const context = buildCandidateContext(items, 5);
    expect(context.candidates[0]).toEqual({
      id: 'n1',
      role: 'textbox',
      text: 'Search',
      score: 0.8,
      bbox: [1, 2, 3, 4]
    });
  });
});
