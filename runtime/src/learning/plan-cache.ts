export interface PlanCacheStep {
  kind: string;
  title: string;
}

export interface PlanTemplate {
  id: string;
  workflowId: string;
  goal: string;
  domain?: string;
  signatureTokens: string[];
  steps: PlanCacheStep[];
  successCount: number;
  failureCount: number;
  qualityScore: number;
  createdAt: string;
  updatedAt: string;
}

export interface PlanTemplateStoreInput {
  workflowId: string;
  goal: string;
  domain?: string;
  steps: PlanCacheStep[];
  status: 'pass' | 'fail';
}

export interface PlanCacheLookupInput {
  workflowId: string;
  goal: string;
  domain?: string;
}

export interface PlanCacheAdaptInput {
  goal: string;
  domain?: string;
}

export interface PlanCacheMatch {
  template: PlanTemplate;
  score: number;
}

export interface PlanCacheOptions {
  similarityThreshold?: number;
  maxTemplates?: number;
}

function nowIso(): string {
  return new Date().toISOString();
}

function normalize(raw: string): string {
  return raw.trim().toLowerCase();
}

function tokenize(raw: string): string[] {
  const text = normalize(raw);
  if (!text) {
    return [];
  }

  return Array.from(new Set(text.split(/[^0-9a-zA-Z가-힣]+/).filter((token) => token.length > 0)));
}

function hostname(raw: string | undefined): string | undefined {
  if (!raw) {
    return undefined;
  }
  try {
    return new URL(raw.startsWith('http') ? raw : `https://${raw}`).hostname.toLowerCase();
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

function signature(goal: string, domain?: string): string[] {
  const goalTokens = tokenize(goal);
  const host = hostname(domain);
  if (host) {
    goalTokens.push(...tokenize(host));
  }
  return Array.from(new Set(goalTokens));
}

function similarity(
  template: PlanTemplate,
  input: PlanCacheLookupInput
): number {
  const querySignature = signature(input.goal, input.domain);
  const tokenScore = jaccard(template.signatureTokens, querySignature);

  const leftHost = hostname(template.domain);
  const rightHost = hostname(input.domain);
  const hostScore =
    leftHost && rightHost
      ? leftHost === rightHost ||
        leftHost.endsWith(`.${rightHost}`) ||
        rightHost.endsWith(`.${leftHost}`) ||
        rootDomain(leftHost) === rootDomain(rightHost)
        ? 1
        : 0
      : 0;

  return tokenScore * 0.65 + hostScore * 0.35;
}

export class PlanCache {
  private readonly templates = new Map<string, PlanTemplate[]>();
  private readonly similarityThreshold: number;
  private readonly maxTemplates: number;

  constructor(options: PlanCacheOptions = {}) {
    this.similarityThreshold = Math.max(0, Math.min(1, options.similarityThreshold ?? 0.45));
    this.maxTemplates = Math.max(10, options.maxTemplates ?? 200);
  }

  private key(workflowId: string): string {
    return normalize(workflowId || 'default');
  }

  private putTemplate(template: PlanTemplate): PlanTemplate {
    const key = this.key(template.workflowId);
    const existing = this.templates.get(key) ?? [];
    const merged = [template, ...existing].slice(0, this.maxTemplates);
    this.templates.set(key, merged);
    return template;
  }

  getById(id: string): PlanTemplate | undefined {
    for (const templates of this.templates.values()) {
      const found = templates.find((template) => template.id === id);
      if (found) {
        return found;
      }
    }
    return undefined;
  }

  storeTemplate(input: PlanTemplateStoreInput): PlanTemplate {
    const now = nowIso();
    const qualityScore = input.status === 'pass' ? 0.9 : 0.4;
    const template: PlanTemplate = {
      id: `plan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      workflowId: input.workflowId || 'default',
      goal: input.goal,
      domain: input.domain,
      signatureTokens: signature(input.goal, input.domain),
      steps: input.steps.map((step) => ({ ...step })),
      successCount: input.status === 'pass' ? 1 : 0,
      failureCount: input.status === 'fail' ? 1 : 0,
      qualityScore,
      createdAt: now,
      updatedAt: now
    };
    return this.putTemplate(template);
  }

  findBestMatch(input: PlanCacheLookupInput): PlanCacheMatch | undefined {
    const key = this.key(input.workflowId);
    const templates = this.templates.get(key) ?? [];
    const scored = templates
      .map((template) => ({
        template,
        score: similarity(template, input) * (0.6 + template.qualityScore * 0.4)
      }))
      .sort((left, right) => right.score - left.score);

    const best = scored[0];
    if (!best || best.score < this.similarityThreshold) {
      return undefined;
    }
    return best;
  }

  adaptSteps(template: PlanTemplate, input: PlanCacheAdaptInput): PlanCacheStep[] {
    const targetHost = hostname(input.domain);
    const sourceHost = hostname(template.domain);

    return template.steps
      .map((step) => {
        if (step.kind !== 'navigate') {
          return { ...step };
        }

        if (!targetHost || !sourceHost) {
          return { ...step };
        }

        const nextTitle = step.title.replace(
          new RegExp(sourceHost.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'),
          targetHost
        );
        return {
          ...step,
          title: nextTitle.includes('https://') ? nextTitle : `Navigate target site https://${targetHost}`
        };
      })
      .filter((step) => {
        if (step.kind !== 'image_search') {
          return true;
        }
        return /(image|사진|유사|similar)/i.test(input.goal);
      });
  }

  recordResult(templateId: string, status: 'pass' | 'fail'): void {
    const template = this.getById(templateId);
    if (!template) {
      return;
    }

    if (status === 'pass') {
      template.successCount += 1;
    } else {
      template.failureCount += 1;
    }

    const total = template.successCount + template.failureCount;
    template.qualityScore =
      total === 0 ? template.qualityScore : template.successCount / total;
    template.updatedAt = nowIso();
  }
}
