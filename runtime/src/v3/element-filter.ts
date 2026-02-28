import { TextMatcher, type TextMatcherOptions } from './text-matcher';
import type { DOMNode, ScoredNode, ScoredNodeMatch } from './types';

export interface ElementFilterOptions extends TextMatcherOptions {}

const ATTRIBUTE_TIERS: Array<{ key: string; weight: number; pick: (node: DOMNode) => string }> = [
  { key: 'text', weight: 1.0, pick: (node) => node.text },
  { key: 'ax_name', weight: 0.95, pick: (node) => node.axName ?? '' },
  { key: 'aria_label', weight: 0.95, pick: (node) => node.attrs['aria-label'] ?? '' },
  { key: 'placeholder', weight: 0.85, pick: (node) => node.attrs.placeholder ?? '' },
  {
    key: 'name_id',
    weight: 0.8,
    pick: (node) => [node.attrs.name, node.attrs.id].filter((value) => value && value.trim().length > 0).join(' ')
  },
  { key: 'class', weight: 0.3, pick: (node) => node.attrs.class ?? '' }
];

export class ElementFilter {
  private readonly matcher: TextMatcher;

  constructor(options: ElementFilterOptions = {}) {
    this.matcher = new TextMatcher(options);
  }

  filter(nodes: DOMNode[], keywordWeights: Record<string, number>, topN = 20): ScoredNode[] {
    const scored: ScoredNode[] = [];

    for (const node of nodes) {
      const matches: ScoredNodeMatch[] = [];
      let totalScore = 0;

      for (const [keyword, rawWeight] of Object.entries(keywordWeights)) {
        const keywordWeight = Number(rawWeight);
        if (!Number.isFinite(keywordWeight) || keywordWeight <= 0) {
          continue;
        }

        for (const attr of ATTRIBUTE_TIERS) {
          const candidateText = attr.pick(node);
          if (!candidateText || candidateText.trim().length === 0) {
            continue;
          }

          const match = this.matcher.match(keyword, candidateText);
          if (match.score <= 0) {
            continue;
          }

          const weightedScore = keywordWeight * match.score * attr.weight;
          totalScore += weightedScore;
          matches.push({
            keyword,
            attribute: attr.key,
            matchType: match.type,
            rawScore: match.score,
            weightedScore
          });
        }
      }

      if (totalScore > 0) {
        scored.push({
          node,
          score: Number(totalScore.toFixed(6)),
          matches
        });
      }
    }

    scored.sort((left, right) => right.score - left.score);
    return scored.slice(0, Math.max(1, Math.floor(topN)));
  }
}
