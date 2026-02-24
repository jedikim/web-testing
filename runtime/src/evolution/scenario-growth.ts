import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import type { EvolutionJob } from './types';

export interface ScenarioItem {
  id: string;
  title: string;
  objective: string;
  minSteps: number;
  checkpoints: string[];
}

export interface ScenarioPack {
  baseline: ScenarioItem;
  exceptions: ScenarioItem[];
}

export interface BuildScenarioPackInput {
  job: EvolutionJob;
  outputDir: string;
  failureHint?: string;
}

export interface BuildScenarioPackResult {
  scenarioPackPath: string;
  baselinePath: string;
  exceptionsPath: string;
}

function triggerSpecificException(trigger: EvolutionJob['trigger']): ScenarioItem[] {
  if (trigger === 'exception') {
    return [
      {
        id: 'exception-ui-drift',
        title: 'UI drift on critical action button',
        objective: 'Recover from selector drift while preserving safety checks.',
        minSteps: 6,
        checkpoints: [
          'Detect selector mismatch',
          'Capture screenshot and DOM snippet',
          'Try rule fallback',
          'Run yolo26 detection if visual anchor exists',
          'Validate action result',
          'Record patch candidate'
        ]
      }
    ];
  }

  return [
    {
      id: 'bug-regression',
      title: 'Reproduce reported bug and verify fix stability',
      objective: 'Ensure bug is reproducible on baseline and fixed in candidate version.',
      minSteps: 6,
      checkpoints: [
        'Replay baseline flow',
        'Confirm failure signature',
        'Apply candidate patch',
        'Re-run flow end-to-end',
        'Verify no collateral regression',
        'Write changelog evidence'
      ]
    }
  ];
}

function baseExceptions(): ScenarioItem[] {
  return [
    {
      id: 'timeout-retry-window',
      title: 'Slow network and timeout recovery',
      objective: 'Verify bounded retry and checkpoint policy under latency.',
      minSteps: 5,
      checkpoints: [
        'Trigger slow page state',
        'Retry within cap',
        'Capture intermediate screenshot',
        'Continue or handoff by policy',
        'Persist attempt log'
      ]
    },
    {
      id: 'captcha-escalation',
      title: 'Captcha escalation workflow',
      objective: 'Enforce yolo26 -> VLM -> LLM sequence with handoff fallback.',
      minSteps: 7,
      checkpoints: [
        'Detect captcha candidate with yolo26',
        'Verify challenge type with VLM',
        'Attempt solve with LLM',
        'Re-validate captcha state',
        'Retry within configured cap',
        'Capture screenshot for each retry',
        'Escalate to human if unresolved'
      ]
    },
    {
      id: 'modal-interruption',
      title: 'Unexpected modal interruption',
      objective: 'Recover from consent/login modal without losing session state.',
      minSteps: 5,
      checkpoints: [
        'Detect modal',
        'Classify as safe/unsafe close',
        'Apply close or bypass rule',
        'Re-validate workflow node',
        'Record policy decision'
      ]
    }
  ];
}

function hintDrivenExceptions(hint?: string): ScenarioItem[] {
  const normalized = hint?.toLowerCase() ?? '';
  if (!normalized) {
    return [];
  }

  const derived: ScenarioItem[] = [];
  if (normalized.includes('403') || normalized.includes('forbidden')) {
    derived.push({
      id: 'auth-rotation',
      title: 'Auth/session rotation',
      objective: 'Handle expired token/session and retry with safe re-auth steps.',
      minSteps: 6,
      checkpoints: [
        'Detect auth failure',
        'Capture pre-retry context',
        'Run safe re-auth rule',
        'Replay failed node',
        'Verify target state',
        'Persist remediation trace'
      ]
    });
  }

  if (normalized.includes('selector') || normalized.includes('not found')) {
    derived.push({
      id: 'selector-healing',
      title: 'Selector healing and promotion candidate',
      objective: 'Generate robust selector candidate and verify with canary runs.',
      minSteps: 6,
      checkpoints: [
        'Collect candidate selectors',
        'Test ranked selectors',
        'Execute action with selected candidate',
        'Verify downstream node pass',
        'Store patch-only proposal',
        'Mark for promotion review'
      ]
    });
  }

  return derived;
}

function createScenarioPack(job: EvolutionJob, failureHint?: string): ScenarioPack {
  const baseline: ScenarioItem = {
    id: 'baseline-regression-check',
    title: 'Baseline deterministic replay',
    objective: 'Ensure baseline scenario remains reproducible before exception handling.',
    minSteps: 5,
    checkpoints: [
      'Load target workflow entry page',
      'Run deterministic steps without LLM',
      'Capture checkpoint screenshot',
      'Verify expected page state',
      'Persist baseline metrics'
    ]
  };

  const exceptions = [
    ...triggerSpecificException(job.trigger),
    ...baseExceptions(),
    ...hintDrivenExceptions(failureHint)
  ];

  return {
    baseline,
    exceptions
  };
}

function markdown(pack: ScenarioPack): string {
  const lines: string[] = ['# Evolution Scenario Pack', ''];
  lines.push('## Baseline');
  lines.push(`- id: ${pack.baseline.id}`);
  lines.push(`- objective: ${pack.baseline.objective}`);
  lines.push(`- minSteps: ${pack.baseline.minSteps}`);
  lines.push('- checkpoints:');
  for (const checkpoint of pack.baseline.checkpoints) {
    lines.push(`  - ${checkpoint}`);
  }
  lines.push('');

  lines.push('## Exception Matrix');
  for (const item of pack.exceptions) {
    lines.push(`### ${item.id}: ${item.title}`);
    lines.push(`- objective: ${item.objective}`);
    lines.push(`- minSteps: ${item.minSteps}`);
    lines.push('- checkpoints:');
    for (const checkpoint of item.checkpoints) {
      lines.push(`  - ${checkpoint}`);
    }
    lines.push('');
  }

  return `${lines.join('\n')}\n`;
}

export async function buildScenarioPack(
  input: BuildScenarioPackInput
): Promise<BuildScenarioPackResult> {
  const pack = createScenarioPack(input.job, input.failureHint);
  const scenarioPackPath = resolve(input.outputDir, 'scenario-pack.json');
  const baselinePath = resolve(input.outputDir, 'BASELINE.md');
  const exceptionsPath = resolve(input.outputDir, 'EXCEPTIONS.md');

  await mkdir(input.outputDir, { recursive: true });
  await writeFile(scenarioPackPath, `${JSON.stringify(pack, null, 2)}\n`, 'utf-8');
  await writeFile(baselinePath, `${markdown({ baseline: pack.baseline, exceptions: [] })}\n`, 'utf-8');
  await writeFile(exceptionsPath, markdown(pack), 'utf-8');

  return {
    scenarioPackPath,
    baselinePath,
    exceptionsPath
  };
}
