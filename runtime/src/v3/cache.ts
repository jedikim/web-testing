import type { Action, CacheEntry, StepPlan } from './types';

export interface CacheLookupInput {
  domain: string;
  url: string;
  taskType: string;
}

function normalizeDomain(raw: string): string {
  return raw.trim().toLowerCase();
}

function normalizeUrlPath(raw: string): string {
  try {
    const parsed = new URL(raw);
    return parsed.pathname || '/';
  } catch {
    return raw;
  }
}

function normalizeTaskType(raw: string): string {
  return raw.trim().toLowerCase();
}

function cacheKey(domain: string, urlPath: string, taskType: string): string {
  return `${normalizeDomain(domain)}::${normalizeUrlPath(urlPath)}::${normalizeTaskType(taskType)}`;
}

export class ActionCache {
  private readonly entries = new Map<string, CacheEntry>();

  lookup(input: CacheLookupInput): CacheEntry | undefined {
    return this.entries.get(cacheKey(input.domain, input.url, input.taskType));
  }

  store(entry: CacheEntry): void {
    const key = cacheKey(entry.domain, entry.urlPattern, entry.taskType);
    const previous = this.entries.get(key);
    const nextSuccessCount = (previous?.successCount ?? 0) + Math.max(1, entry.successCount);
    this.entries.set(key, {
      ...entry,
      successCount: nextSuccessCount,
      lastSuccess: new Date().toISOString()
    });
  }

  toAction(entry: CacheEntry): Action {
    return {
      selector: entry.selector,
      actionType: entry.actionType,
      value: entry.value,
      viewportXY: entry.viewportXY,
      viewportBbox: entry.viewportBbox
    };
  }
}

export class PlanCache {
  private readonly plans = new Map<string, StepPlan[]>();

  lookup(domain: string, task: string): StepPlan[] | undefined {
    return this.plans.get(cacheKey(domain, '/', task));
  }

  store(domain: string, task: string, steps: StepPlan[]): void {
    this.plans.set(cacheKey(domain, '/', task), steps.map((step) => ({ ...step })));
  }
}
