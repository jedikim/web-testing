import type { RunArtifact } from '../types';

export interface ReplaySimilarityQuery {
  query: string;
  targetUrl?: string;
  limit?: number;
}

export interface ReplaySimilarityMatch {
  run: RunArtifact;
  score: number;
  matchedKeywords: string[];
}

function normalizeText(raw: string): string {
  return raw.trim().toLowerCase();
}

function tokenize(raw: string): string[] {
  const normalized = normalizeText(raw);
  if (!normalized) {
    return [];
  }
  return Array.from(
    new Set(normalized.split(/[^0-9a-zA-Z가-힣]+/).filter((token) => token.length > 0))
  );
}

function hostnameFromUrl(raw: string | undefined): string | undefined {
  if (!raw) {
    return undefined;
  }
  try {
    return new URL(raw).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

function rootDomain(host: string | undefined): string | undefined {
  if (!host) {
    return undefined;
  }
  const parts = host.split('.').filter(Boolean);
  if (parts.length <= 2) {
    return host;
  }
  return parts.slice(-2).join('.');
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

export class ReplayStore {
  private readonly runs: RunArtifact[] = [];

  add(run: RunArtifact): void {
    this.runs.push(run);
  }

  getByWorkflow(workflowId: string): RunArtifact[] {
    return this.runs.filter((run) => run.workflowId === workflowId);
  }

  getFailedRuns(workflowId: string): RunArtifact[] {
    return this.runs.filter((run) => run.workflowId === workflowId && run.status === 'fail');
  }

  findSimilar(workflowId: string, query: ReplaySimilarityQuery): ReplaySimilarityMatch[] {
    const queryTokens = tokenize(query.query);
    const queryHost = hostnameFromUrl(query.targetUrl);
    const limit = Math.max(1, query.limit ?? 5);

    const scored = this.runs
      .filter((run) => run.workflowId === workflowId)
      .map((run) => {
        const runTokens = tokenize(
          [
            run.workflowId,
            run.context.targetUrl,
            ...run.steps.map((step) => `${step.nodeType} ${step.action} ${step.target ?? ''}`),
            ...run.failures.map((failure) => `${failure.code} ${failure.message}`)
          ].join(' ')
        );
        const tokenScore = jaccard(queryTokens, runTokens);

        const runHost = hostnameFromUrl(run.context.targetUrl);
        const hostScore =
          queryHost && runHost
            ? queryHost === runHost ||
              queryHost.endsWith(`.${runHost}`) ||
              runHost.endsWith(`.${queryHost}`) ||
              rootDomain(queryHost) === rootDomain(runHost)
              ? 1
              : 0
            : 0;

        const matchedKeywords = queryTokens.filter((token) => runTokens.includes(token));
        const coverageScore =
          queryTokens.length > 0
            ? matchedKeywords.length / queryTokens.length
            : tokenScore;
        const score = tokenScore * 0.5 + hostScore * 0.35 + coverageScore * 0.15;

        return {
          run,
          score,
          matchedKeywords
        };
      })
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, limit);

    return scored;
  }
}
