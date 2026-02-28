import type { Skill, StepPlan } from './types';

export interface SkillValidationResult {
  ok: boolean;
  violations: string[];
}

export interface SynthesizeSkillInput {
  domain: string;
  task: string;
  plan: StepPlan[];
}

function normalizeTaskPattern(task: string): string {
  return task.replace(/\s+/g, ' ').trim().toLowerCase();
}

function slugify(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
}

function escapePy(raw: string): string {
  return raw.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function pythonActionLine(step: StepPlan): string {
  const target = escapePy(step.targetDescription);
  const value = escapePy(step.value ?? '');
  if (step.actionType === 'type') {
    return `    await browser.type_text('${target}', '${value}')`;
  }
  if (step.actionType === 'wait') {
    return '    await browser.wait_ms(500)';
  }
  if (step.actionType === 'navigate') {
    return `    await browser.goto('${value}')`;
  }
  return `    await browser.click_target('${target}')`;
}

export function validateSkillCode(code: string): SkillValidationResult {
  const violations: string[] = [];
  const bannedPatterns: Array<{ pattern: RegExp; reason: string }> = [
    { pattern: /\bimport\b/, reason: 'import is not allowed in synthesized skills' },
    { pattern: /\bexec\b/, reason: 'exec is not allowed' },
    { pattern: /\beval\b/, reason: 'eval is not allowed' },
    { pattern: /\bsubprocess\b/, reason: 'subprocess access is not allowed' },
    { pattern: /\bos\./, reason: 'os module access is not allowed' },
    { pattern: /\bopen\s*\(/, reason: 'file I/O is not allowed' }
  ];
  for (const rule of bannedPatterns) {
    if (rule.pattern.test(code)) {
      violations.push(rule.reason);
    }
  }

  const allowedBrowserCalls = ['click_target', 'type_text', 'goto', 'wait_ms'];
  const browserCallMatches = code.match(/browser\.([a-z_]+)\s*\(/g) ?? [];
  for (const match of browserCallMatches) {
    const call = match.replace(/browser\.|\s*\(/g, '');
    if (!allowedBrowserCalls.includes(call)) {
      violations.push(`non-whitelisted browser api: ${call}`);
    }
  }

  return {
    ok: violations.length === 0,
    violations
  };
}

export class SkillSynthesizer {
  synthesize(input: SynthesizeSkillInput): Skill {
    const normalizedTask = normalizeTaskPattern(input.task);
    const name = `${slugify(input.domain)}__${slugify(normalizedTask)}`;
    const codeLines = [
      'async def run_skill(browser):',
      "    \"\"\"Auto-synthesized skill from successful trajectory.\"\"\""
    ];
    for (const step of input.plan) {
      codeLines.push(pythonActionLine(step));
    }
    if (input.plan.length === 0) {
      codeLines.push('    return');
    }
    const code = `${codeLines.join('\n')}\n`;
    const validation = validateSkillCode(code);
    if (!validation.ok) {
      throw new Error(`invalid synthesized skill: ${validation.violations.join('; ')}`);
    }

    return {
      name,
      domain: input.domain,
      taskPattern: normalizedTask,
      code,
      plan: input.plan.map((step) => ({ ...step })),
      successCount: 1,
      createdAt: new Date().toISOString(),
      lastSuccess: new Date().toISOString()
    };
  }
}

export class SkillRegistry {
  private readonly skills = new Map<string, Skill>();

  upsert(skill: Skill): void {
    const key = `${skill.domain}::${skill.taskPattern}`;
    const previous = this.skills.get(key);
    this.skills.set(key, {
      ...skill,
      successCount: (previous?.successCount ?? 0) + Math.max(1, skill.successCount),
      lastSuccess: new Date().toISOString()
    });
  }

  find(domain: string, task: string): Skill | undefined {
    const normalizedDomain = domain.trim().toLowerCase();
    const normalizedTask = normalizeTaskPattern(task);
    const direct = this.skills.get(`${normalizedDomain}::${normalizedTask}`);
    if (direct) {
      return direct;
    }

    const queryTokens = new Set(normalizedTask.match(/[0-9a-zA-Z가-힣]+/g) ?? []);
    let best: Skill | undefined;
    let bestScore = 0;
    for (const skill of this.skills.values()) {
      if (skill.domain !== normalizedDomain) {
        continue;
      }
      const tokens = skill.taskPattern.match(/[0-9a-zA-Z가-힣]+/g) ?? [];
      const overlap = tokens.filter((token) => queryTokens.has(token)).length;
      const score = tokens.length === 0 ? 0 : overlap / tokens.length;
      if (score > bestScore && score >= 0.5) {
        best = skill;
        bestScore = score;
      }
    }
    return best;
  }
}
