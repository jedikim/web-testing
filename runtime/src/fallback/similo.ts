import type { SelectorPatch } from './patch-validator';
import type { CandidateItem } from './context-reducer';
import type { SelectorFingerprint, SelectorRecipe } from './recipe-version';

interface SimiloCandidateView {
  css?: string;
  text?: string;
  role?: string;
  idHint?: string;
  classTokens: string[];
  nearbyText: string[];
  bboxNorm?: [number, number, number, number];
}

export interface SimiloMatch {
  selectorKey: string;
  candidate: CandidateItem;
  css: string;
  score: number;
}

export interface ProposePatchFromSimiloInput {
  recipe: SelectorRecipe;
  candidates: CandidateItem[];
  preferredSelectorKey?: string;
  threshold?: number;
}

function normalizeText(raw: string | undefined): string {
  return (raw ?? '').trim().toLowerCase();
}

function tokenize(raw: string | undefined): string[] {
  const text = normalizeText(raw);
  if (!text) {
    return [];
  }

  return Array.from(new Set(text.split(/[^0-9a-zA-Z가-힣]+/).filter((value) => value.length > 0)));
}

function textSimilarity(left: string | undefined, right: string | undefined): number {
  const a = normalizeText(left);
  const b = normalizeText(right);
  if (!a && !b) {
    return 1;
  }

  const tokenScore = jaccard(tokenize(a), tokenize(b));
  if (!a || !b) {
    return tokenScore;
  }

  // Korean UI labels often expand short text into phrase form (e.g., "검색" vs "검색어를 입력하세요")
  // so substring containment is treated as a strong signal.
  const containsScore = a.includes(b) || b.includes(a) ? 0.74 : 0;
  return Math.max(tokenScore, containsScore);
}

function jaccard(left: string[], right: string[]): number {
  if (left.length === 0 && right.length === 0) {
    return 1;
  }

  const a = new Set(left);
  const b = new Set(right);
  const intersection = [...a].filter((value) => b.has(value)).length;
  const union = new Set([...a, ...b]).size;
  if (union === 0) {
    return 0;
  }
  return intersection / union;
}

function toNumber(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }
  return value;
}

function asBox(raw: unknown): [number, number, number, number] | undefined {
  if (!Array.isArray(raw) || raw.length !== 4) {
    return undefined;
  }
  const x = toNumber(raw[0]);
  const y = toNumber(raw[1]);
  const w = toNumber(raw[2]);
  const h = toNumber(raw[3]);
  if (x === undefined || y === undefined || w === undefined || h === undefined) {
    return undefined;
  }
  return [x, y, w, h];
}

function bboxSimilarity(
  left: [number, number, number, number] | undefined,
  right: [number, number, number, number] | undefined
): number {
  if (!left || !right) {
    return 0.5;
  }

  const leftCenter = [left[0] + left[2] / 2, left[1] + left[3] / 2];
  const rightCenter = [right[0] + right[2] / 2, right[1] + right[3] / 2];
  const dx = leftCenter[0] - rightCenter[0];
  const dy = leftCenter[1] - rightCenter[1];
  const distance = Math.sqrt(dx * dx + dy * dy);
  return Math.max(0, 1 - distance);
}

function candidateToView(candidate: CandidateItem): SimiloCandidateView {
  const attributes = candidate.attributes ?? {};
  const css = attributes.css?.trim() || attributes.selector?.trim();
  const idHint = attributes.id?.trim() || candidate.id;
  const classTokens = tokenize(attributes.class ?? attributes.className ?? '');
  const nearbyText = tokenize(attributes.nearbyText ?? attributes.nearby ?? '');
  const bboxNorm = asBox(attributes.bboxNorm) ?? candidate.bbox;

  return {
    css,
    text: candidate.text,
    role: candidate.role,
    idHint,
    classTokens,
    nearbyText,
    bboxNorm
  };
}

function toCssSelector(candidate: CandidateItem, view: SimiloCandidateView): string | undefined {
  if (view.css && view.css.length > 0) {
    return view.css;
  }

  if (candidate.attributes?.['data-testid']) {
    return `[data-testid="${candidate.attributes['data-testid']}"]`;
  }

  const idHint = view.idHint?.trim();
  if (idHint) {
    return `[id="${idHint.replaceAll('"', '\\"')}"]`;
  }

  return undefined;
}

export function scoreSimiloFingerprint(
  fingerprint: SelectorFingerprint | undefined,
  candidate: CandidateItem
): number {
  if (!fingerprint) {
    return 0;
  }

  const view = candidateToView(candidate);

  const textScore = textSimilarity(fingerprint.text, view.text);
  const roleScore =
    normalizeText(fingerprint.role).length === 0
      ? 0.5
      : normalizeText(fingerprint.role) === normalizeText(view.role)
        ? 1
        : 0;
  const idScore =
    normalizeText(fingerprint.idHint).length === 0
      ? 0.5
      : normalizeText(view.idHint).includes(normalizeText(fingerprint.idHint))
        ? 1
        : 0;
  const classScore = jaccard(fingerprint.classTokens ?? [], view.classTokens);
  const nearbyScore = jaccard(fingerprint.nearbyText ?? [], view.nearbyText);
  const bboxScore = bboxSimilarity(fingerprint.bboxNorm, view.bboxNorm);

  return (
    textScore * 0.33 +
    roleScore * 0.12 +
    idScore * 0.18 +
    classScore * 0.16 +
    nearbyScore * 0.11 +
    bboxScore * 0.1
  );
}

function bestMatchForSelector(
  selectorKey: string,
  fingerprint: SelectorFingerprint | undefined,
  candidates: CandidateItem[]
): SimiloMatch | undefined {
  let best: SimiloMatch | undefined;

  for (const candidate of candidates) {
    const view = candidateToView(candidate);
    const css = toCssSelector(candidate, view);
    if (!css) {
      continue;
    }

    const score = scoreSimiloFingerprint(fingerprint, candidate);
    if (!best || score > best.score) {
      best = {
        selectorKey,
        candidate,
        css,
        score
      };
    }
  }

  return best;
}

export function proposePatchFromSimilo(input: ProposePatchFromSimiloInput): SelectorPatch | undefined {
  if (input.candidates.length === 0) {
    return undefined;
  }

  const threshold = input.threshold ?? 0.52;
  const keys = input.preferredSelectorKey
    ? [input.preferredSelectorKey]
    : Object.keys(input.recipe.selectors);

  let best: SimiloMatch | undefined;
  for (const key of keys) {
    const entry = input.recipe.selectors[key];
    if (!entry?.fingerprint) {
      continue;
    }

    const match = bestMatchForSelector(key, entry.fingerprint, input.candidates);
    if (!match) {
      continue;
    }
    if (!best || match.score > best.score) {
      best = match;
    }
  }

  if (!best || best.score < threshold) {
    return undefined;
  }

  return {
    target: 'selectors',
    reason: `similo fingerprint recovery score=${best.score.toFixed(3)}`,
    operations: [
      {
        op: 'replace',
        path: `/selectors/${best.selectorKey}`,
        value: {
          css: best.css,
          fingerprint: {
            text: best.candidate.text,
            role: best.candidate.role,
            idHint: best.candidate.id
          }
        }
      }
    ]
  };
}
