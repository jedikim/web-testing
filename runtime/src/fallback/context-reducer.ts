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

export interface CandidateContext {
  candidates: ReducedCandidate[];
}

export function buildCandidateContext(items: CandidateItem[], maxCandidates = 8): CandidateContext {
  const candidates = [...items]
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, maxCandidates))
    .map((item) => ({
      id: item.id,
      role: item.role,
      text: item.text,
      score: item.score,
      bbox: item.bbox
    }));

  return { candidates };
}
