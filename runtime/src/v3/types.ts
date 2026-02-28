export interface DOMNode {
  nodeId: number;
  backendNodeId?: number;
  tag: string;
  text: string;
  attrs: Record<string, string>;
  axRole?: string;
  axName?: string;
}

export type MatchType = 'exact' | 'phrase' | 'word' | 'synonym' | 'fuzzy' | 'none';

export interface MatchResult {
  type: MatchType;
  score: number;
}

export interface ScoredNodeMatch {
  keyword: string;
  attribute: string;
  matchType: MatchType;
  rawScore: number;
  weightedScore: number;
}

export interface ScoredNode {
  node: DOMNode;
  score: number;
  matches: ScoredNodeMatch[];
}
