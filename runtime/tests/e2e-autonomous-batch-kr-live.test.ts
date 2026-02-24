import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { loadEnvFiles } from '../src/config/load-env-file';
import { loadRuntimeEnv } from '../src/config/env';
import { runAssistantlessChatE2E, type AssistantlessChatE2EOutput, type LoopDecision, type StepAction } from '../src/testing/assistantless-chat-e2e';

type ScenarioStatus = 'pass' | 'blocked';

interface ScenarioRunContext {
  page: import('playwright').Page;
  scenarioDir: string;
  iteration: number;
}

interface ScenarioPlanning {
  objective: string;
  complexity: string;
  steps: string[];
  references: string[];
}

interface BatchScenario {
  id: string;
  expectedStatus: ScenarioStatus;
  minSteps: number;
  planning?: ScenarioPlanning;
  run: (ctx: ScenarioRunContext) => Promise<AssistantlessChatE2EOutput>;
}

interface BatchRow {
  scenarioId: string;
  iteration: number;
  expectedStatus: ScenarioStatus;
  actualStatus: 'pass' | 'fail' | 'blocked';
  steps: number;
  llmCalls: number;
  ruleCalls: number;
  visionCalls: number;
  revisions: number;
  decisions: string[];
  snapshotsShared: number;
  captchaYoloCalls: number;
  captchaVlmCalls: number;
  captchaLlmSolveCalls: number;
  captchaRetries: number;
  recordDir: string;
}

const TEST_DIR = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = resolve(TEST_DIR, '..', '..');
loadEnvFiles({ cwd: REPO_ROOT, filenames: ['runtime/.env', '.env'] });

const runtimeEnv = loadRuntimeEnv({
  PW_HEADLESS: process.env.PW_HEADLESS,
  PLAYWRIGHT_TIMEOUT_MS: process.env.PLAYWRIGHT_TIMEOUT_MS
});

const RUN_AUTONOMOUS_BATCH_E2E = process.env.RUN_AUTONOMOUS_BATCH_E2E === '1';
const E2E_TIMEOUT_MS = Math.max(runtimeEnv.playwrightTimeoutMs * 60, 900000);

function parseIterations(raw: string | undefined): number {
  if (!raw) {
    return 2;
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) {
    return 2;
  }
  return Math.min(Math.floor(n), 8);
}

const AUTONOMOUS_BATCH_ITERATIONS = parseIterations(process.env.AUTONOMOUS_BATCH_ITERATIONS);
const WORKTREE_MARKER = '/.worktrees/';
const PROJECT_ROOT = REPO_ROOT.includes(WORKTREE_MARKER)
  ? REPO_ROOT.slice(0, REPO_ROOT.indexOf(WORKTREE_MARKER))
  : REPO_ROOT;
const PROJECT_TESTING_ROOT = join(PROJECT_ROOT, 'testing');
const DEFAULT_BATCH_ROOT = join(PROJECT_TESTING_ROOT, 'autonomous-batch');

function resolveBatchRoot(): string {
  const configured = process.env.AUTONOMOUS_BATCH_ROOT?.trim();
  if (!configured) {
    return DEFAULT_BATCH_ROOT;
  }
  return configured.startsWith('/') ? resolve(configured) : resolve(PROJECT_ROOT, configured);
}

function assertWithinTestingRoot(path: string): void {
  const normalizedTestingRoot = PROJECT_TESTING_ROOT.endsWith('/')
    ? PROJECT_TESTING_ROOT
    : `${PROJECT_TESTING_ROOT}/`;
  const normalizedPath = path.endsWith('/') ? path : `${path}/`;
  if (!normalizedPath.startsWith(normalizedTestingRoot)) {
    throw new Error(
      `AUTONOMOUS_BATCH_ROOT must be under project testing root. current=${path} requiredPrefix=${PROJECT_TESTING_ROOT}`
    );
  }
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function makeRunRoot(): string {
  const batchRoot = resolveBatchRoot();
  assertWithinTestingRoot(batchRoot);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const root = join(batchRoot, stamp);
  mkdirSync(root, { recursive: true });
  return root;
}

async function captureScreenshotWithFallback(
  page: import('playwright').Page,
  path: string
): Promise<void> {
  try {
    await page.screenshot({ path, fullPage: true });
  } catch {
    await page.waitForTimeout(200);
    await page.screenshot({ path });
  }
}

function nowStamp(): string {
  return new Date().toISOString();
}

function writeScenarioArtifacts(
  scenarioDir: string,
  timeline: string[],
  result: AssistantlessChatE2EOutput
): void {
  const md = ['# Process', '', '| time | event | detail |', '|---|---|---|', ...timeline].join('\n');
  writeFileSync(join(scenarioDir, 'process.md'), md, 'utf-8');
  writeFileSync(join(scenarioDir, 'result.json'), JSON.stringify(result, null, 2), 'utf-8');
}

function decodeQueryKeyword(target: string): string {
  const queryPart =
    target.split('/search/')[1] ??
    target.split('query=')[1] ??
    target.split('?q=')[1] ??
    target.split('&q=')[1] ??
    '';
  if (!queryPart) {
    return '';
  }
  const cleaned = queryPart.split(/[?&#]/)[0].replace(/\+/g, ' ');
  try {
    return decodeURIComponent(cleaned);
  } catch {
    return cleaned;
  }
}

function buildWorkflowMarkdown(scenarios: BatchScenario[]): string {
  return [
    '# Workflow',
    '',
    '## Purpose',
    '- Fully autonomous web-automation validation with no manual intervention.',
    '- Save all evidence under project testing root (screenshots, process logs, summaries).',
    '',
    '## Execution Loop',
    '1. Capture before screenshot.',
    '2. Analyze with LLM (warmup) or rule-first planner.',
    '3. Execute browser action and verify.',
    '4. On failure, apply vision/captcha escalation and revise.',
    '5. Capture after screenshot and append process log.',
    '6. Repeat until done/blocked.',
    '7. Write final per-scenario artifacts and run summary.',
    '',
    '## Scenario Catalog',
    '| scenario | expected | minSteps |',
    '|---|---|---:|',
    ...scenarios.map((scenario) => `| ${scenario.id} | ${scenario.expectedStatus} | ${scenario.minSteps} |`),
    '',
    '## Evidence Files',
    '- `<scenario>/iteration-XX/process.md`',
    '- `<scenario>/iteration-XX/result.json`',
    '- `<scenario>/iteration-XX/step-YY-before.png`',
    '- `<scenario>/iteration-XX/step-YY-after.png`',
    '- `<scenario>/PLAN.md`, `<scenario>/WORKFLOW.md`, `<scenario>/FINAL-OPTIMIZED-RESULT.md`',
    '- `PLANNING.md`, `summary.json`, `summary.md`, `FINAL-OPTIMIZED-RESULT.md`'
  ].join('\n');
}

function getScenarioPlanning(scenario: BatchScenario): ScenarioPlanning {
  if (scenario.planning) {
    return scenario.planning;
  }
  return {
    objective: `Execute ${scenario.id} with rule-first autonomous loop`,
    complexity: 'standard',
    steps: [
      'Capture before screenshot',
      'Choose LLM/rule action',
      'Execute browser step and verify',
      'Share after screenshot and append process log',
      'Repeat until done/blocked'
    ],
    references: ['https://www.naver.com', 'https://search.daum.net']
  };
}

function buildRunPlanningMarkdown(scenarios: BatchScenario[]): string {
  const lines = [
    '# Planning',
    '',
    '## Goal',
    '- Build and validate complex autonomous KR web-automation scenarios with headful execution.',
    '',
    '## Internet-Validated Targets',
    '- https://www.naver.com',
    '- https://search.naver.com',
    '- https://map.naver.com',
    '- https://www.daum.net',
    '- https://search.daum.net',
    '- https://map.kakao.com',
    '- https://www.weather.go.kr/w/index.do',
    '- https://www.visitkorea.or.kr/main/main.do',
    '- https://korean.visitseoul.net/index',
    '- https://www.korail.com',
    '- https://www.seoul.go.kr/main/index.jsp',
    '- https://www.childcare.go.kr/',
    '',
    '## Scenario Design'
  ];

  for (const scenario of scenarios) {
    const plan = getScenarioPlanning(scenario);
    lines.push('');
    lines.push(`### ${scenario.id}`);
    lines.push(`- objective: ${plan.objective}`);
    lines.push(`- complexity: ${plan.complexity}`);
    lines.push(`- minSteps: ${scenario.minSteps}`);
    lines.push('- stepPlan:');
    for (const step of plan.steps) {
      lines.push(`  - ${step}`);
    }
    lines.push('- references:');
    for (const ref of plan.references) {
      lines.push(`  - ${ref}`);
    }
  }

  lines.push('');
  lines.push('## Validation');
  lines.push('- Headful browser run');
  lines.push('- Per-step screenshots');
  lines.push('- Per-scenario process log + summary + optimized result');
  return lines.join('\n');
}

function buildFinalOptimizedResultMarkdown(rows: BatchRow[]): string {
  const scenarioIds = Array.from(new Set(rows.map((row) => row.scenarioId)));
  const lines = [
    '# Final Optimized Result',
    '',
    '## KPI',
    `- totalRuns: ${rows.length}`,
    `- passRuns: ${rows.filter((row) => row.actualStatus === 'pass').length}`,
    `- blockedRuns: ${rows.filter((row) => row.actualStatus === 'blocked').length}`,
    `- failRuns: ${rows.filter((row) => row.actualStatus === 'fail').length}`,
    '',
    '## Scenario Stats',
    '| scenario | runCount | passRate | avgSteps | avgLLM | avgRule | avgVision | avgRevisions |',
    '|---|---:|---:|---:|---:|---:|---:|---:|'
  ];

  for (const id of scenarioIds) {
    const items = rows.filter((row) => row.scenarioId === id);
    const runCount = items.length;
    const passRate = runCount === 0 ? 0 : (items.filter((row) => row.actualStatus === 'pass').length / runCount) * 100;
    const avgSteps = runCount === 0 ? 0 : items.reduce((sum, row) => sum + row.steps, 0) / runCount;
    const avgLLM = runCount === 0 ? 0 : items.reduce((sum, row) => sum + row.llmCalls, 0) / runCount;
    const avgRule = runCount === 0 ? 0 : items.reduce((sum, row) => sum + row.ruleCalls, 0) / runCount;
    const avgVision = runCount === 0 ? 0 : items.reduce((sum, row) => sum + row.visionCalls, 0) / runCount;
    const avgRevisions = runCount === 0 ? 0 : items.reduce((sum, row) => sum + row.revisions, 0) / runCount;
    lines.push(
      `| ${id} | ${runCount} | ${passRate.toFixed(1)}% | ${avgSteps.toFixed(1)} | ${avgLLM.toFixed(1)} | ${avgRule.toFixed(1)} | ${avgVision.toFixed(1)} | ${avgRevisions.toFixed(1)} |`
    );
  }

  lines.push('');
  lines.push('## Optimized Policy');
  lines.push('1. LLM warmup only for initial understanding, then rule-first execution.');
  lines.push('2. On first selector drift/failure, perform one revise cycle with vision hint.');
  lines.push('3. For captcha, keep chain fixed: YOLO26 detect -> VLM confirm -> LLM solve retry.');
  lines.push('4. Block sensitive steps (login/payment/delete) with not_go policy.');
  lines.push('5. Keep evidence mandatory for every step (before/after screenshots + process log).');
  return lines.join('\n');
}

function buildScenarioWorkflowMarkdown(scenario: BatchScenario): string {
  const plan = getScenarioPlanning(scenario);
  return [
    '# Scenario Workflow',
    '',
    `- scenario: ${scenario.id}`,
    `- expected: ${scenario.expectedStatus}`,
    `- minSteps: ${scenario.minSteps}`,
    `- objective: ${plan.objective}`,
    `- complexity: ${plan.complexity}`,
    '',
    '## Loop',
    '1. Before screenshot',
    '2. LLM/rule decision',
    '3. Execute + verify',
    '4. Revise/captcha escalation if needed',
    '5. After screenshot + process log',
    '6. Repeat until done/blocked',
    '',
    '## Planned Steps',
    ...plan.steps.map((step, index) => `${index + 1}. ${step}`),
    '',
    '## References',
    ...plan.references.map((ref) => `- ${ref}`)
  ].join('\n');
}

function buildScenarioPlanMarkdown(scenario: BatchScenario): string {
  const plan = getScenarioPlanning(scenario);
  return [
    '# Scenario Plan',
    '',
    `- scenario: ${scenario.id}`,
    `- expectedStatus: ${scenario.expectedStatus}`,
    `- minSteps: ${scenario.minSteps}`,
    `- complexity: ${plan.complexity}`,
    '',
    '## Objective',
    `- ${plan.objective}`,
    '',
    '## Step Blueprint',
    ...plan.steps.map((step, index) => `${index + 1}. ${step}`),
    '',
    '## Internet References',
    ...plan.references.map((ref) => `- ${ref}`)
  ].join('\n');
}

function buildScenarioSummaryMarkdown(scenarioId: string, rows: BatchRow[]): string {
  return [
    '# Scenario Summary',
    '',
    `- scenario: ${scenarioId}`,
    `- runs: ${rows.length}`,
    `- pass: ${rows.filter((row) => row.actualStatus === 'pass').length}`,
    `- blocked: ${rows.filter((row) => row.actualStatus === 'blocked').length}`,
    `- fail: ${rows.filter((row) => row.actualStatus === 'fail').length}`,
    '',
    '| iteration | expected | actual | steps | llm | rule | vision | revisions | decisions |',
    '|---:|---|---|---:|---:|---:|---:|---:|---|',
    ...rows.map(
      (row) =>
        `| ${row.iteration} | ${row.expectedStatus} | ${row.actualStatus} | ${row.steps} | ${row.llmCalls} | ${row.ruleCalls} | ${row.visionCalls} | ${row.revisions} | ${row.decisions.join(',')} |`
    )
  ].join('\n');
}

function chooseAutonomousDecision(question: string, previous: LoopDecision[]): LoopDecision {
  const normalized = question.toLowerCase();
  if (
    normalized.includes('로그인') ||
    normalized.includes('결제') ||
    normalized.includes('submit') ||
    normalized.includes('삭제') ||
    normalized.includes('탈퇴')
  ) {
    return 'not_go';
  }

  if (
    normalized.includes('selector') ||
    normalized.includes('revise') ||
    normalized.includes('수정') ||
    normalized.includes('captcha') ||
    normalized.includes('캡차')
  ) {
    return previous.includes('revise') ? 'go' : 'revise';
  }

  return 'go';
}

async function executeActionWithPlaywright(
  page: import('playwright').Page,
  action: StepAction,
  timeout: number
): Promise<void> {
  if (action.kind === 'goto') {
    if (!action.target) {
      throw new Error('goto action requires target');
    }
    await page.goto(action.target, { waitUntil: 'domcontentloaded', timeout });
    return;
  }
  if (action.kind === 'type') {
    if (!action.target) {
      throw new Error('type action requires target');
    }
    await page.waitForSelector(action.target, { timeout });
    await page.fill(action.target, action.value ?? '');
    return;
  }
  if (action.kind === 'press_enter') {
    if (!action.target) {
      throw new Error('press_enter action requires target');
    }
    await page.waitForSelector(action.target, { timeout });
    await page.press(action.target, 'Enter', { timeout });
    return;
  }
  if (action.kind === 'checkpoint') {
    return;
  }
  throw new Error(`unsupported action: ${action.kind}`);
}

function buildScenarios(timeout: number): BatchScenario[] {
  const scenarioA: BatchScenario = {
    id: 'autonomous_naver_weather_news_finance',
    expectedStatus: 'pass',
    minSteps: 5,
    run: async ({ page, scenarioDir, iteration }) => {
      let progress = 0;
      const timeline: string[] = [];

      const result = await runAssistantlessChatE2E({
        goal: `Autonomous A (${iteration + 1})`,
        llmWarmupSteps: 1,
        maxSteps: 8,
        captureScreenshot: async ({ step, stage }) => {
          const path = join(scenarioDir, `step-${pad2(step + 1)}-${stage}.png`);
          await captureScreenshotWithFallback(page, path);
          return path;
        },
        shareWithUser: async (snapshot) => {
          timeline.push(
            `| ${nowStamp()} | share | step=${snapshot.step + 1} stage=${snapshot.stage} status=${snapshot.status ?? 'na'} |`
          );
        },
        analyzeWithLlm: async () => {
          if (progress === 0) return { kind: 'goto', target: 'https://www.naver.com' };
          if (progress === 1) return { kind: 'type', target: 'input[name="query"]', value: '날씨' };
          if (progress === 2) return { kind: 'press_enter', target: 'input[name="query"]' };
          if (progress === 3) return { kind: 'goto', target: 'https://news.naver.com' };
          return { kind: 'goto', target: 'https://finance.naver.com' };
        },
        decideWithRules: async () => {
          if (progress === 0) return { kind: 'goto', target: 'https://www.naver.com' };
          if (progress === 1) return { kind: 'type', target: 'input[name="query"]', value: '날씨' };
          if (progress === 2) return { kind: 'press_enter', target: 'input[name="query"]' };
          if (progress === 3) return { kind: 'goto', target: 'https://news.naver.com' };
          return { kind: 'goto', target: 'https://finance.naver.com' };
        },
        executeAction: async ({ action }) => {
          timeline.push(`| ${nowStamp()} | execute | progress=${progress} action=${action.kind}:${action.target ?? ''} |`);
          try {
            if (progress === 0) {
              await executeActionWithPlaywright(page, action, timeout);
              await page.waitForSelector('input[name="query"]', { timeout });
              progress += 1;
              return { status: 'pass', done: false };
            }
            if (progress === 1) {
              await executeActionWithPlaywright(page, action, timeout);
              const value = await page.inputValue('input[name="query"]');
              if (!value.includes('날씨')) {
                return { status: 'fail', reason: `query mismatch: ${value}`, userQuestion: '검색어 수정할까요?' };
              }
              progress += 1;
              return { status: 'pass', done: false };
            }
            if (progress === 2) {
              await executeActionWithPlaywright(page, action, timeout);
              await page.waitForURL(/search\.naver\.com/, { timeout });
              progress += 1;
              return { status: 'pass', done: false };
            }
            if (progress === 3) {
              await executeActionWithPlaywright(page, action, timeout);
              await page.waitForURL(/news\.naver\.com/, { timeout });
              progress += 1;
              return { status: 'pass', done: false };
            }
            await executeActionWithPlaywright(page, action, timeout);
            await page.waitForURL(/finance\.naver\.com/, { timeout });
            progress += 1;
            return { status: 'pass', done: true };
          } catch (error) {
            return {
              status: 'fail',
              reason: error instanceof Error ? error.message : String(error),
              userQuestion: '실행 오류입니다. 계속할까요?'
            };
          }
        },
        askUserDecision: async ({ question }) => chooseAutonomousDecision(question, [])
      });

      writeScenarioArtifacts(scenarioDir, timeline, result);
      return result;
    }
  };

  const scenarioB: BatchScenario = {
    id: 'autonomous_cross_site_selector_recovery',
    expectedStatus: 'pass',
    minSteps: 6,
    run: async ({ page, scenarioDir, iteration }) => {
      let progress = 0;
      let firstSelectorFailure = true;
      const decisionHistory: LoopDecision[] = [];
      const timeline: string[] = [];

      const result = await runAssistantlessChatE2E({
        goal: `Autonomous B (${iteration + 1})`,
        llmWarmupSteps: 2,
        maxSteps: 9,
        captureScreenshot: async ({ step, stage }) => {
          const path = join(scenarioDir, `step-${pad2(step + 1)}-${stage}.png`);
          await captureScreenshotWithFallback(page, path);
          return path;
        },
        shareWithUser: async (snapshot) => {
          timeline.push(
            `| ${nowStamp()} | share | step=${snapshot.step + 1} stage=${snapshot.stage} status=${snapshot.status ?? 'na'} |`
          );
        },
        analyzeWithLlm: async () => {
          if (progress === 0) return { kind: 'goto', target: 'https://www.daum.net' };
          if (progress === 1) {
            if (firstSelectorFailure) return { kind: 'type', target: 'input[name="query"]', value: '뉴스' };
            return { kind: 'type', target: 'input[name="q"]', value: '뉴스' };
          }
          if (progress === 2) return { kind: 'press_enter', target: 'input[name="q"]' };
          if (progress === 3) return { kind: 'goto', target: 'https://news.naver.com' };
          if (progress === 4) return { kind: 'goto', target: 'https://www.daum.net' };
          return { kind: 'goto', target: 'https://search.daum.net/search?w=tot&q=%EB%89%B4%EC%8A%A4' };
        },
        decideWithRules: async () => {
          if (progress === 0) return { kind: 'goto', target: 'https://www.daum.net' };
          if (progress === 1) return { kind: 'type', target: 'input[name="q"]', value: '뉴스' };
          if (progress === 2) return { kind: 'press_enter', target: 'input[name="q"]' };
          if (progress === 3) return { kind: 'goto', target: 'https://news.naver.com' };
          if (progress === 4) return { kind: 'goto', target: 'https://www.daum.net' };
          return { kind: 'goto', target: 'https://search.daum.net/search?w=tot&q=%EB%89%B4%EC%8A%A4' };
        },
        detectWithVision: async () => ({
          model: 'yolo26l',
          target: 'input[name="q"]',
          confidence: 0.86
        }),
        executeAction: async ({ action }) => {
          timeline.push(`| ${nowStamp()} | execute | progress=${progress} action=${action.kind}:${action.target ?? ''} |`);
          try {
            if (progress === 0) {
              await executeActionWithPlaywright(page, action, timeout);
              await page.waitForSelector('input[name="q"]', { timeout });
              progress += 1;
              return { status: 'pass', done: false };
            }
            if (progress === 1) {
              if (action.target !== 'input[name="q"]') {
                firstSelectorFailure = false;
                return { status: 'fail', reason: 'selector drift', userQuestion: 'selector 수정 후 계속할까요?' };
              }
              await executeActionWithPlaywright(page, action, timeout);
              const value = await page.inputValue('input[name="q"]');
              if (!value.includes('뉴스')) {
                return { status: 'fail', reason: 'query mismatch', userQuestion: '입력값 수정할까요?' };
              }
              progress += 1;
              return { status: 'pass', done: false };
            }
            if (progress === 2) {
              await executeActionWithPlaywright(page, action, timeout);
              await page.waitForURL(/search\.daum\.net/, { timeout });
              progress += 1;
              return { status: 'pass', done: false };
            }
            if (progress === 3) {
              await executeActionWithPlaywright(page, action, timeout);
              await page.waitForURL(/news\.naver\.com/, { timeout });
              progress += 1;
              return { status: 'pass', done: false };
            }
            if (progress === 4) {
              await executeActionWithPlaywright(page, action, timeout);
              await page.waitForURL(/daum\.net/, { timeout });
              progress += 1;
              return { status: 'pass', done: false };
            }
            await executeActionWithPlaywright(page, action, timeout);
            await page.waitForURL(/search\.daum\.net/, { timeout });
            progress += 1;
            return { status: 'pass', done: true };
          } catch (error) {
            return {
              status: 'fail',
              reason: error instanceof Error ? error.message : String(error),
              userQuestion: '실행 오류가 발생했습니다. revise 할까요?'
            };
          }
        },
        askUserDecision: async ({ question }) => {
          const decision = chooseAutonomousDecision(question, decisionHistory);
          decisionHistory.push(decision);
          timeline.push(`| ${nowStamp()} | decision | question="${question}" decision=${decision} |`);
          return decision;
        }
      });

      writeScenarioArtifacts(scenarioDir, timeline, result);
      return result;
    }
  };

  const scenarioC: BatchScenario = {
    id: 'autonomous_captcha_chain_with_retry',
    expectedStatus: 'pass',
    minSteps: 5,
    run: async ({ page, scenarioDir, iteration }) => {
      let progress = 0;
      let captchaChecked = false;
      const timeline: string[] = [];

      const result = await runAssistantlessChatE2E({
        goal: `Autonomous C (${iteration + 1})`,
        llmWarmupSteps: 1,
        maxSteps: 8,
        captchaMaxRetries: 3,
        captureScreenshot: async ({ step, stage }) => {
          const path = join(scenarioDir, `step-${pad2(step + 1)}-${stage}.png`);
          await captureScreenshotWithFallback(page, path);
          return path;
        },
        shareWithUser: async (snapshot) => {
          timeline.push(
            `| ${nowStamp()} | share | step=${snapshot.step + 1} stage=${snapshot.stage} status=${snapshot.status ?? 'na'} |`
          );
        },
        analyzeWithLlm: async () => {
          if (progress === 0) return { kind: 'goto', target: 'https://www.naver.com' };
          if (progress === 1) return { kind: 'type', target: 'input[name="query"]', value: '날씨' };
          if (progress === 2) return { kind: 'press_enter', target: 'input[name="query"]' };
          if (progress === 3) return { kind: 'goto', target: 'https://search.daum.net/search?w=tot&q=%EB%89%B4%EC%8A%A4' };
          return { kind: 'goto', target: 'https://finance.naver.com' };
        },
        decideWithRules: async () => {
          if (progress === 0) return { kind: 'goto', target: 'https://www.naver.com' };
          if (progress === 1) return { kind: 'type', target: 'input[name="query"]', value: '날씨' };
          if (progress === 2) return { kind: 'press_enter', target: 'input[name="query"]' };
          if (progress === 3) return { kind: 'goto', target: 'https://search.daum.net/search?w=tot&q=%EB%89%B4%EC%8A%A4' };
          return { kind: 'goto', target: 'https://finance.naver.com' };
        },
        detectCaptchaWithYolo: async () => {
          if (!captchaChecked && progress >= 1) {
            captchaChecked = true;
            timeline.push(`| ${nowStamp()} | captcha-yolo | detected=true confidence=0.79 |`);
            return { detected: true, confidence: 0.79, label: 'captcha' };
          }
          return { detected: false };
        },
        confirmCaptchaWithVlm: async () => {
          timeline.push(`| ${nowStamp()} | captcha-vlm | confirmed=true |`);
          return { confirmed: true, reason: 'captcha widget likely present' };
        },
        solveCaptchaWithLlm: async ({ attempt }) => {
          timeline.push(`| ${nowStamp()} | captcha-llm | attempt=${attempt} |`);
          return { solved: true, action: { kind: 'click', target: 'body', value: `solve-${attempt}` } };
        },
        executeCaptchaSolveAction: async () => true,
        verifyCaptchaCleared: async ({ attempt }) => attempt >= 2,
        executeAction: async ({ action }) => {
          timeline.push(`| ${nowStamp()} | execute | progress=${progress} action=${action.kind}:${action.target ?? ''} |`);
          try {
            if (progress === 0) {
              await executeActionWithPlaywright(page, action, timeout);
              await page.waitForSelector('input[name="query"]', { timeout });
              progress += 1;
              return { status: 'pass', done: false };
            }
            if (progress === 1) {
              await executeActionWithPlaywright(page, action, timeout);
              progress += 1;
              return { status: 'pass', done: false };
            }
            if (progress === 2) {
              await executeActionWithPlaywright(page, action, timeout);
              await page.waitForURL(/search\.naver\.com/, { timeout });
              progress += 1;
              return { status: 'pass', done: false };
            }
            if (progress === 3) {
              await executeActionWithPlaywright(page, action, timeout);
              await page.waitForURL(/search\.daum\.net/, { timeout });
              progress += 1;
              return { status: 'pass', done: false };
            }
            await executeActionWithPlaywright(page, action, timeout);
            await page.waitForURL(/finance\.naver\.com/, { timeout });
            progress += 1;
            return { status: 'pass', done: true };
          } catch (error) {
            return {
              status: 'fail',
              reason: error instanceof Error ? error.message : String(error),
              userQuestion: '캡차 이후 단계 오류. 계속할까요?'
            };
          }
        },
        askUserDecision: async ({ question }) => chooseAutonomousDecision(question, [])
      });

      writeScenarioArtifacts(scenarioDir, timeline, result);
      return result;
    }
  };

  const scenarioD: BatchScenario = {
    id: 'autonomous_sensitive_gate_blocked_after_5_steps',
    expectedStatus: 'blocked',
    minSteps: 5,
    run: async ({ page, scenarioDir, iteration }) => {
      let progress = 0;
      const decisionHistory: LoopDecision[] = [];
      const timeline: string[] = [];

      const result = await runAssistantlessChatE2E({
        goal: `Autonomous D (${iteration + 1})`,
        llmWarmupSteps: 1,
        maxSteps: 7,
        captureScreenshot: async ({ step, stage }) => {
          const path = join(scenarioDir, `step-${pad2(step + 1)}-${stage}.png`);
          await captureScreenshotWithFallback(page, path);
          return path;
        },
        shareWithUser: async (snapshot) => {
          timeline.push(
            `| ${nowStamp()} | share | step=${snapshot.step + 1} stage=${snapshot.stage} status=${snapshot.status ?? 'na'} |`
          );
        },
        analyzeWithLlm: async () => {
          if (progress === 0) return { kind: 'goto', target: 'https://www.naver.com' };
          if (progress === 1) return { kind: 'goto', target: 'https://news.naver.com' };
          if (progress === 2) return { kind: 'goto', target: 'https://finance.naver.com' };
          if (progress === 3) return { kind: 'goto', target: 'https://www.daum.net' };
          return { kind: 'checkpoint', target: 'login-required' };
        },
        decideWithRules: async () => {
          if (progress === 0) return { kind: 'goto', target: 'https://www.naver.com' };
          if (progress === 1) return { kind: 'goto', target: 'https://news.naver.com' };
          if (progress === 2) return { kind: 'goto', target: 'https://finance.naver.com' };
          if (progress === 3) return { kind: 'goto', target: 'https://www.daum.net' };
          return { kind: 'checkpoint', target: 'login-required' };
        },
        executeAction: async ({ action }) => {
          timeline.push(`| ${nowStamp()} | execute | progress=${progress} action=${action.kind}:${action.target ?? ''} |`);
          try {
            if (progress <= 3) {
              await executeActionWithPlaywright(page, action, timeout);
              await page.waitForSelector('body', { timeout });
              progress += 1;
              return { status: 'pass', done: false };
            }

            return {
              status: 'fail',
              reason: '로그인 필요한 민감 액션',
              userQuestion: '로그인 액션입니다. 계속 진행할까요?'
            };
          } catch (error) {
            return {
              status: 'fail',
              reason: error instanceof Error ? error.message : String(error),
              userQuestion: '민감 구간 오류. 계속할까요?'
            };
          }
        },
        askUserDecision: async ({ question }) => {
          const decision = chooseAutonomousDecision(question, decisionHistory);
          decisionHistory.push(decision);
          timeline.push(`| ${nowStamp()} | decision | question="${question}" decision=${decision} |`);
          return decision;
        }
      });

      writeScenarioArtifacts(scenarioDir, timeline, result);
      return result;
    }
  };

  const scenarioE: BatchScenario = {
    id: 'autonomous_weather_family_places_from_pangyo_map_naver',
    expectedStatus: 'pass',
    minSteps: 8,
    run: async ({ page, scenarioDir, iteration }) => {
      let progress = 0;
      const timeline: string[] = [];
      const scriptedActions: StepAction[] = [
        { kind: 'goto', target: 'https://www.naver.com' },
        { kind: 'type', target: 'input[name="query"]', value: '오늘 날씨' },
        { kind: 'press_enter', target: 'input[name="query"]' },
        {
          kind: 'goto',
          target: 'https://search.naver.com/search.naver?query=%EC%84%9C%EC%9A%B8%20%EA%B7%BC%EA%B5%90%20%EC%95%84%EC%9D%B4%EC%99%80%20%EA%B0%88%EB%A7%8C%ED%95%9C%EA%B3%B3'
        },
        {
          kind: 'goto',
          target:
            'https://map.naver.com/p/search/%ED%8C%90%EA%B5%90%EC%97%AD%20%EC%95%84%EC%9D%B4%EC%99%80%20%EA%B0%80%EB%B3%BC%EB%A7%8C%ED%95%9C%20%EA%B3%B3'
        },
        {
          kind: 'goto',
          target:
            'https://map.naver.com/p/search/%ED%8C%90%EA%B5%90%EC%97%AD%20%ED%82%A4%EC%A6%88%EC%B9%B4%ED%8E%98'
        },
        {
          kind: 'goto',
          target:
            'https://map.naver.com/p/search/%ED%8C%90%EA%B5%90%EC%97%AD%20%EC%96%B4%EB%A6%B0%EC%9D%B4%20%EB%B0%95%EB%AC%BC%EA%B4%80'
        },
        {
          kind: 'goto',
          target:
            'https://map.naver.com/p/search/%ED%8C%90%EA%B5%90%EC%97%AD%20%EA%B0%80%EC%A1%B1%20%EA%B3%B5%EC%9B%90'
        }
      ];

      const result = await runAssistantlessChatE2E({
        goal: `Autonomous E (${iteration + 1}) - weather then family places near Pangyo`,
        llmWarmupSteps: 2,
        maxSteps: 10,
        captureScreenshot: async ({ step, stage }) => {
          const path = join(scenarioDir, `step-${pad2(step + 1)}-${stage}.png`);
          await captureScreenshotWithFallback(page, path);
          return path;
        },
        shareWithUser: async (snapshot) => {
          timeline.push(
            `| ${nowStamp()} | share | step=${snapshot.step + 1} stage=${snapshot.stage} status=${snapshot.status ?? 'na'} |`
          );
        },
        analyzeWithLlm: async () => scriptedActions[Math.min(progress, scriptedActions.length - 1)],
        decideWithRules: async () => scriptedActions[Math.min(progress, scriptedActions.length - 1)],
        executeAction: async ({ action }) => {
          timeline.push(`| ${nowStamp()} | execute | progress=${progress} action=${action.kind}:${action.target ?? ''} |`);
          try {
            await executeActionWithPlaywright(page, action, timeout);
            if (progress === 0) {
              await page.waitForSelector('input[name="query"]', { timeout });
            } else if (progress === 1) {
              const value = await page.inputValue('input[name="query"]');
              if (!value.includes('오늘 날씨')) {
                return {
                  status: 'fail',
                  reason: `search keyword mismatch: ${value}`,
                  userQuestion: '날씨 검색어를 수정할까요?'
                };
              }
            } else if (progress === 2 || progress === 3) {
              await page.waitForURL(/search\.naver\.com/, { timeout });
            } else {
              await page.waitForURL(/map\.naver\.com/, { timeout });
              if (action.target) {
                const keyword = decodeQueryKeyword(action.target);
                if (keyword) {
                  timeline.push(`| ${nowStamp()} | map-query | keyword=${keyword} |`);
                }
              }
            }
            progress += 1;
            const done = progress >= scriptedActions.length;
            if (done) {
              timeline.push(
                `| ${nowStamp()} | summary | weather+map flow complete near Pangyo station family spots |`
              );
            }
            return { status: 'pass', done };
          } catch (error) {
            return {
              status: 'fail',
              reason: error instanceof Error ? error.message : String(error),
              userQuestion: '목표 플로우 재분석 후 계속할까요?'
            };
          }
        },
        askUserDecision: async ({ question }) => {
          const decision = chooseAutonomousDecision(question, []);
          timeline.push(`| ${nowStamp()} | decision | question="${question}" decision=${decision} |`);
          return decision;
        }
      });

      writeScenarioArtifacts(scenarioDir, timeline, result);
      return result;
    }
  };

  const scenarioF: BatchScenario = {
    id: 'autonomous_weather_to_cross_site_family_route_plan',
    expectedStatus: 'pass',
    minSteps: 9,
    run: async ({ page, scenarioDir, iteration }) => {
      let progress = 0;
      let firstMapTargetFailure = true;
      const decisionHistory: LoopDecision[] = [];
      const timeline: string[] = [];
      const scriptedActions: StepAction[] = [
        { kind: 'goto', target: 'https://www.naver.com' },
        { kind: 'type', target: 'input[name="query"]', value: '판교역 오늘 날씨 미세먼지' },
        { kind: 'press_enter', target: 'input[name="query"]' },
        {
          kind: 'goto',
          target: 'https://search.naver.com/search.naver?query=%ED%8C%90%EA%B5%90%EC%97%AD%20%EC%95%84%EC%9D%B4%EC%99%80%20%EA%B0%80%EB%B3%BC%EB%A7%8C%ED%95%9C%EA%B3%B3%20%ED%9B%84%EA%B8%B0'
        },
        {
          kind: 'goto',
          target:
            'https://map.naver.com/p/search/%ED%8C%90%EA%B5%90%EC%97%AD%20%EC%95%84%EC%9D%B4%20%EC%8B%A4%EB%82%B4%20%EC%B2%B4%ED%97%98'
        },
        {
          kind: 'goto',
          target:
            'https://map.naver.com/p/search/%ED%8C%90%EA%B5%90%EC%97%AD%20%EC%A3%BC%EC%B0%A8%20%ED%8E%B8%ED%95%9C%20%EA%B3%B5%EC%9B%90'
        },
        { kind: 'goto', target: 'https://www.daum.net' },
        {
          kind: 'goto',
          target: 'https://search.daum.net/search?w=tot&q=%ED%8C%90%EA%B5%90%EC%97%AD%20%ED%82%A4%EC%A6%88%20%EC%B9%B4%ED%8E%98%20%ED%9B%84%EA%B8%B0'
        },
        {
          kind: 'goto',
          target:
            'https://map.naver.com/p/search/%ED%8C%90%EA%B5%90%EC%97%AD%20%ED%82%A4%EC%A6%88%20%EB%B8%8C%EB%9F%B0%EC%B9%98'
        }
      ];

      const result = await runAssistantlessChatE2E({
        goal: `Autonomous F (${iteration + 1}) - weather, reviews, map shortlist`,
        llmWarmupSteps: 2,
        maxSteps: 12,
        captureScreenshot: async ({ step, stage }) => {
          const path = join(scenarioDir, `step-${pad2(step + 1)}-${stage}.png`);
          await captureScreenshotWithFallback(page, path);
          return path;
        },
        shareWithUser: async (snapshot) => {
          timeline.push(
            `| ${nowStamp()} | share | step=${snapshot.step + 1} stage=${snapshot.stage} status=${snapshot.status ?? 'na'} |`
          );
        },
        analyzeWithLlm: async () => {
          const action = scriptedActions[Math.min(progress, scriptedActions.length - 1)];
          if (progress === 4 && firstMapTargetFailure) {
            return { ...action, target: 'https://map.naver.com/p/search/%ED%8C%90%EA%B5%90%EC%97%AD%20%ED%82%A4%EC%A6%88%20%EC%B9%B4%ED%8E%98' };
          }
          return action;
        },
        decideWithRules: async () => scriptedActions[Math.min(progress, scriptedActions.length - 1)],
        detectWithVision: async () => ({
          model: 'yolo26l',
          target: 'map.naver.com',
          confidence: 0.82
        }),
        executeAction: async ({ action }) => {
          timeline.push(`| ${nowStamp()} | execute | progress=${progress} action=${action.kind}:${action.target ?? ''} |`);
          try {
            if (progress === 4 && firstMapTargetFailure) {
              firstMapTargetFailure = false;
              return {
                status: 'fail',
                reason: '후보군 우선순위 재조정 필요',
                userQuestion: '키즈카페 대신 실내 체험 우선으로 revise 할까요?'
              };
            }
            await executeActionWithPlaywright(page, action, timeout);
            if (progress === 0) {
              await page.waitForSelector('input[name="query"]', { timeout });
            } else if (progress === 1) {
              const value = await page.inputValue('input[name="query"]');
              if (!value.includes('판교역')) {
                return { status: 'fail', reason: 'query missing pangyo', userQuestion: '검색어를 수정할까요?' };
              }
            } else if (progress === 2 || progress === 3) {
              await page.waitForURL(/search\.naver\.com/, { timeout });
            } else if (progress === 4 || progress === 5 || progress === 8) {
              await page.waitForURL(/map\.naver\.com/, { timeout });
            } else if (progress === 6) {
              await page.waitForURL(/daum\.net/, { timeout });
            } else if (progress === 7) {
              await page.waitForURL(/search\.daum\.net/, { timeout });
            }
            if (action.target?.includes('/search/')) {
              const keyword = decodeQueryKeyword(action.target);
              if (keyword) {
                timeline.push(`| ${nowStamp()} | query-logged | keyword=${keyword} |`);
              }
            }
            progress += 1;
            const done = progress >= scriptedActions.length;
            if (done) {
              timeline.push(`| ${nowStamp()} | summary | weather+review+map shortlist complete |`);
            }
            return { status: 'pass', done };
          } catch (error) {
            return {
              status: 'fail',
              reason: error instanceof Error ? error.message : String(error),
              userQuestion: '실패 단계 재시도할까요?'
            };
          }
        },
        askUserDecision: async ({ question }) => {
          const decision = chooseAutonomousDecision(question, decisionHistory);
          decisionHistory.push(decision);
          timeline.push(`| ${nowStamp()} | decision | question="${question}" decision=${decision} |`);
          return decision;
        }
      });

      writeScenarioArtifacts(scenarioDir, timeline, result);
      return result;
    }
  };

  const scenarioG: BatchScenario = {
    id: 'autonomous_weekend_family_trip_multisource_planning',
    expectedStatus: 'pass',
    minSteps: 13,
    planning: {
      objective:
        '판교역 기준 가족 주말 일정 수립을 위해 날씨/관광/지도/후기 정보를 교차 수집하고 최종 후보를 정리한다.',
      complexity: 'high (13-step, multi-domain, revise branch, map aggregation)',
      steps: [
        'Naver에서 판교역 주말 날씨를 조회한다.',
        '기상청 날씨누리에서 날씨 기준을 재확인한다.',
        'Naver/Daum 검색으로 실내 체험 후기 키워드를 수집한다.',
        'Naver Map/Kakao Map에서 장소 후보군을 반복 탐색한다.',
        'VisitSeoul/서울시 페이지로 공공 정보 출처를 교차 검증한다.',
        '실패 시 revise 분기로 후보 우선순위를 재조정한다.',
        '최종 지도 후보를 추가 조회하고 로그로 남긴다.'
      ],
      references: [
        'https://www.naver.com',
        'https://search.naver.com',
        'https://map.naver.com',
        'https://www.daum.net',
        'https://search.daum.net',
        'https://map.kakao.com',
        'https://www.weather.go.kr/w/index.do',
        'https://korean.visitseoul.net/index',
        'https://www.seoul.go.kr/main/index.jsp'
      ]
    },
    run: async ({ page, scenarioDir, iteration }) => {
      let progress = 0;
      let firstResearchConflict = true;
      const decisionHistory: LoopDecision[] = [];
      const timeline: string[] = [];
      const scriptedActions: StepAction[] = [
        { kind: 'goto', target: 'https://www.naver.com' },
        { kind: 'type', target: 'input[name="query"]', value: '판교역 주말 날씨' },
        { kind: 'press_enter', target: 'input[name="query"]' },
        { kind: 'goto', target: 'https://www.weather.go.kr/w/index.do' },
        {
          kind: 'goto',
          target:
            'https://search.naver.com/search.naver?query=%ED%8C%90%EA%B5%90%EC%97%AD%20%EC%84%9C%EC%9A%B8%20%EA%B7%BC%EA%B5%90%20%EC%95%84%EC%9D%B4%20%EC%8B%A4%EB%82%B4%20%EC%B2%B4%ED%97%98'
        },
        {
          kind: 'goto',
          target:
            'https://map.naver.com/p/search/%ED%8C%90%EA%B5%90%EC%97%AD%20%ED%82%A4%EC%A6%88%EC%B9%B4%ED%8E%98'
        },
        {
          kind: 'goto',
          target:
            'https://map.naver.com/p/search/%ED%8C%90%EA%B5%90%EC%97%AD%20%EC%96%B4%EB%A6%B0%EC%9D%B4%20%EB%B0%95%EB%AC%BC%EA%B4%80'
        },
        { kind: 'goto', target: 'https://korean.visitseoul.net/index' },
        {
          kind: 'goto',
          target:
            'https://search.daum.net/search?w=tot&q=%ED%8C%90%EA%B5%90%EC%97%AD%20%EC%95%84%EC%9D%B4%20%EC%8B%A4%EB%82%B4%20%EC%B2%B4%ED%97%98%20%ED%9B%84%EA%B8%B0'
        },
        {
          kind: 'goto',
          target:
            'https://map.kakao.com/?q=%ED%8C%90%EA%B5%90%EC%97%AD%20%ED%82%A4%EC%A6%88%EC%B9%B4%ED%8E%98'
        },
        { kind: 'goto', target: 'https://www.seoul.go.kr/main/index.jsp' },
        {
          kind: 'goto',
          target:
            'https://map.naver.com/p/search/%ED%8C%90%EA%B5%90%EC%97%AD%20%EA%B0%80%EC%A1%B1%20%EB%B8%8C%EB%9F%B0%EC%B9%98'
        },
        {
          kind: 'goto',
          target:
            'https://map.naver.com/p/search/%ED%8C%90%EA%B5%90%EC%97%AD%20%EC%9A%B0%EC%B2%9C%20%EC%8B%A4%EB%82%B4%20%EB%86%80%EC%9D%B4%ED%84%B0'
        }
      ];

      const result = await runAssistantlessChatE2E({
        goal: `Autonomous G (${iteration + 1}) - multisource family trip planning`,
        llmWarmupSteps: 2,
        maxSteps: 18,
        captureScreenshot: async ({ step, stage }) => {
          const path = join(scenarioDir, `step-${pad2(step + 1)}-${stage}.png`);
          await captureScreenshotWithFallback(page, path);
          return path;
        },
        shareWithUser: async (snapshot) => {
          timeline.push(
            `| ${nowStamp()} | share | step=${snapshot.step + 1} stage=${snapshot.stage} status=${snapshot.status ?? 'na'} |`
          );
        },
        analyzeWithLlm: async () => scriptedActions[Math.min(progress, scriptedActions.length - 1)],
        decideWithRules: async () => scriptedActions[Math.min(progress, scriptedActions.length - 1)],
        detectWithVision: async () => ({
          model: 'yolo26l',
          target: progress >= 9 ? 'map.kakao.com' : 'map.naver.com',
          confidence: 0.84
        }),
        executeAction: async ({ action }) => {
          timeline.push(`| ${nowStamp()} | execute | progress=${progress} action=${action.kind}:${action.target ?? ''} |`);
          try {
            if (progress === 8 && firstResearchConflict) {
              firstResearchConflict = false;
              return {
                status: 'fail',
                reason: '후기 출처 충돌로 검색 범위 재정의 필요',
                userQuestion: '후기 검색 범위를 조정하도록 revise 할까요?'
              };
            }

            await executeActionWithPlaywright(page, action, timeout);
            if (progress === 0) {
              await page.waitForSelector('input[name="query"]', { timeout });
            } else if (progress === 1) {
              const value = await page.inputValue('input[name="query"]');
              if (!value.includes('판교역')) {
                return { status: 'fail', reason: 'query missing pangyo', userQuestion: '검색어를 수정할까요?' };
              }
            } else if (progress === 2 || progress === 4) {
              await page.waitForURL(/search\.naver\.com/, { timeout });
            } else if (progress === 3) {
              await page.waitForURL(/weather\.go\.kr/, { timeout });
            } else if (progress === 5 || progress === 6 || progress === 11 || progress === 12) {
              await page.waitForURL(/map\.naver\.com/, { timeout });
            } else if (progress === 7) {
              await page.waitForURL(/visitseoul\.net/, { timeout });
            } else if (progress === 8) {
              await page.waitForURL(/search\.daum\.net/, { timeout });
            } else if (progress === 9) {
              await page.waitForURL(/map\.kakao\.com/, { timeout });
            } else if (progress === 10) {
              await page.waitForURL(/seoul\.go\.kr/, { timeout });
            }
            if (action.target?.includes('/search/') || action.target?.includes('query=') || action.target?.includes('q=')) {
              const keyword = decodeQueryKeyword(action.target);
              if (keyword) {
                timeline.push(`| ${nowStamp()} | research-query | keyword=${keyword} |`);
              }
            }
            progress += 1;
            const done = progress >= scriptedActions.length;
            if (done) {
              timeline.push(`| ${nowStamp()} | summary | multisource family trip planning complete |`);
            }
            return { status: 'pass', done };
          } catch (error) {
            return {
              status: 'fail',
              reason: error instanceof Error ? error.message : String(error),
              userQuestion: '교차 출처 수집 실패입니다. revise 후 재시도할까요?'
            };
          }
        },
        askUserDecision: async ({ question }) => {
          const decision = chooseAutonomousDecision(question, decisionHistory);
          decisionHistory.push(decision);
          timeline.push(`| ${nowStamp()} | decision | question="${question}" decision=${decision} |`);
          return decision;
        }
      });

      writeScenarioArtifacts(scenarioDir, timeline, result);
      return result;
    }
  };

  const scenarioH: BatchScenario = {
    id: 'autonomous_public_info_transport_chain_with_captcha',
    expectedStatus: 'pass',
    minSteps: 13,
    planning: {
      objective: '날씨/교통/육아 공공정보와 지도 탐색을 묶고, 중간 캡차 체인 재시도를 포함해 안정성을 검증한다.',
      complexity: 'high (13-step, two captcha events, multi-domain public info chain)',
      steps: [
        'Naver에서 판교역 날씨 검색 후 기상청으로 이동한다.',
        'KORAIL/Daum/지도로 교통 관련 단서를 수집한다.',
        '아이사랑/VisitKorea 공공 사이트로 정보 출처를 확장한다.',
        '중간 단계에서 두 번의 캡차 이벤트를 YOLO26->VLM->LLM 체인으로 처리한다.',
        '지도 후보군을 반복 탐색하고 최종 추천 후보를 남긴다.'
      ],
      references: [
        'https://www.naver.com',
        'https://search.naver.com',
        'https://www.weather.go.kr/w/index.do',
        'https://www.korail.com',
        'https://search.daum.net',
        'https://map.naver.com',
        'https://www.childcare.go.kr/',
        'https://www.visitkorea.or.kr/main/main.do',
        'https://map.kakao.com'
      ]
    },
    run: async ({ page, scenarioDir, iteration }) => {
      let progress = 0;
      let captchaSequence = 0;
      let currentCaptchaRequiredAttempt = 1;
      const captchaTriggeredAt = new Set<number>();
      const timeline: string[] = [];
      const scriptedActions: StepAction[] = [
        { kind: 'goto', target: 'https://www.naver.com' },
        { kind: 'type', target: 'input[name="query"]', value: '판교역 오늘 강수량' },
        { kind: 'press_enter', target: 'input[name="query"]' },
        { kind: 'goto', target: 'https://www.weather.go.kr/w/index.do' },
        { kind: 'goto', target: 'https://www.korail.com' },
        {
          kind: 'goto',
          target:
            'https://search.daum.net/search?w=tot&q=%ED%8C%90%EA%B5%90%EC%97%AD%20%EB%B2%84%EC%8A%A4%20%ED%99%98%EC%8A%B9%20%EC%A0%95%EB%B3%B4'
        },
        {
          kind: 'goto',
          target:
            'https://map.naver.com/p/search/%ED%8C%90%EA%B5%90%EC%97%AD%20%EB%B2%84%EC%8A%A4%20%ED%99%98%EC%8A%B9%EC%84%BC%ED%84%B0'
        },
        { kind: 'goto', target: 'https://www.childcare.go.kr/' },
        { kind: 'goto', target: 'https://www.visitkorea.or.kr/main/main.do' },
        {
          kind: 'goto',
          target:
            'https://map.kakao.com/?q=%ED%8C%90%EA%B5%90%EC%97%AD%20%EC%96%B4%EB%A6%B0%EC%9D%B4%20%EC%B2%B4%ED%97%98'
        },
        {
          kind: 'goto',
          target:
            'https://map.naver.com/p/search/%ED%8C%90%EA%B5%90%EC%97%AD%20%EC%8B%A4%EB%82%B4%20%EC%95%84%EC%9D%B4%20%EC%B2%B4%ED%97%98'
        },
        {
          kind: 'goto',
          target:
            'https://map.naver.com/p/search/%ED%8C%90%EA%B5%90%EC%97%AD%20%EA%B0%80%EC%A1%B1%20%EC%8B%9D%EB%8B%B9'
        },
        {
          kind: 'goto',
          target:
            'https://map.naver.com/p/search/%ED%8C%90%EA%B5%90%EC%97%AD%20%EC%96%B4%EB%A6%B0%EC%9D%B4%20%EA%B3%B5%EC%97%B0'
        }
      ];

      const result = await runAssistantlessChatE2E({
        goal: `Autonomous H (${iteration + 1}) - public transport chain with captcha`,
        llmWarmupSteps: 2,
        maxSteps: 18,
        captchaMaxRetries: 3,
        captureScreenshot: async ({ step, stage }) => {
          const path = join(scenarioDir, `step-${pad2(step + 1)}-${stage}.png`);
          await captureScreenshotWithFallback(page, path);
          return path;
        },
        shareWithUser: async (snapshot) => {
          timeline.push(
            `| ${nowStamp()} | share | step=${snapshot.step + 1} stage=${snapshot.stage} status=${snapshot.status ?? 'na'} |`
          );
        },
        analyzeWithLlm: async () => scriptedActions[Math.min(progress, scriptedActions.length - 1)],
        decideWithRules: async () => scriptedActions[Math.min(progress, scriptedActions.length - 1)],
        detectCaptchaWithYolo: async () => {
          if ((progress === 2 || progress === 7) && !captchaTriggeredAt.has(progress)) {
            captchaTriggeredAt.add(progress);
            captchaSequence += 1;
            currentCaptchaRequiredAttempt = captchaSequence === 1 ? 2 : 1;
            timeline.push(
              `| ${nowStamp()} | captcha-yolo | detected=true step=${progress + 1} requiredAttempt=${currentCaptchaRequiredAttempt} |`
            );
            return { detected: true, confidence: 0.81, label: 'captcha' };
          }
          return { detected: false };
        },
        confirmCaptchaWithVlm: async () => {
          timeline.push(`| ${nowStamp()} | captcha-vlm | confirmed=true |`);
          return { confirmed: true, reason: 'captcha-like widget detected in public chain' };
        },
        solveCaptchaWithLlm: async ({ attempt }) => {
          timeline.push(`| ${nowStamp()} | captcha-llm | sequence=${captchaSequence} attempt=${attempt} |`);
          return { solved: true, action: { kind: 'click', target: 'body', value: `captcha-${captchaSequence}-${attempt}` } };
        },
        executeCaptchaSolveAction: async () => true,
        verifyCaptchaCleared: async ({ attempt }) => attempt >= currentCaptchaRequiredAttempt,
        executeAction: async ({ action }) => {
          timeline.push(`| ${nowStamp()} | execute | progress=${progress} action=${action.kind}:${action.target ?? ''} |`);
          try {
            await executeActionWithPlaywright(page, action, timeout);
            if (progress === 0) {
              await page.waitForSelector('input[name="query"]', { timeout });
            } else if (progress === 1) {
              const value = await page.inputValue('input[name="query"]');
              if (!value.includes('판교역')) {
                return { status: 'fail', reason: 'query missing pangyo', userQuestion: '검색어를 조정할까요?' };
              }
            } else if (progress === 2) {
              await page.waitForURL(/search\.naver\.com/, { timeout });
            } else if (progress === 3) {
              await page.waitForURL(/weather\.go\.kr/, { timeout });
            } else if (progress === 4) {
              await page.waitForURL(/korail\.com/, { timeout });
            } else if (progress === 5) {
              await page.waitForURL(/search\.daum\.net/, { timeout });
            } else if (progress === 6 || progress === 10 || progress === 11 || progress === 12) {
              await page.waitForURL(/map\.naver\.com/, { timeout });
            } else if (progress === 7) {
              await page.waitForURL(/childcare\.go\.kr/, { timeout });
            } else if (progress === 8) {
              await page.waitForURL(/visitkorea\.or\.kr/, { timeout });
            } else if (progress === 9) {
              await page.waitForURL(/map\.kakao\.com/, { timeout });
            }
            if (action.target?.includes('/search/') || action.target?.includes('query=') || action.target?.includes('q=')) {
              const keyword = decodeQueryKeyword(action.target);
              if (keyword) {
                timeline.push(`| ${nowStamp()} | public-query | keyword=${keyword} |`);
              }
            }
            progress += 1;
            const done = progress >= scriptedActions.length;
            if (done) {
              timeline.push(`| ${nowStamp()} | summary | public transport chain complete with captcha handling |`);
            }
            return { status: 'pass', done };
          } catch (error) {
            return {
              status: 'fail',
              reason: error instanceof Error ? error.message : String(error),
              userQuestion: '공공 정보 체인 실패입니다. 계속 revise 할까요?'
            };
          }
        },
        askUserDecision: async ({ question }) => {
          const decision = chooseAutonomousDecision(question, []);
          timeline.push(`| ${nowStamp()} | decision | question="${question}" decision=${decision} |`);
          return decision;
        }
      });

      writeScenarioArtifacts(scenarioDir, timeline, result);
      return result;
    }
  };

  const scenarioI: BatchScenario = {
    id: 'autonomous_budget_route_selector_drift_double_revise',
    expectedStatus: 'pass',
    minSteps: 14,
    planning: {
      objective: '가격/후기/위치 기반 가족 외출 후보를 만들고, selector drift/우선순위 drift를 두 번 복구한다.',
      complexity: 'very high (14-step, double revise, multi-map/search domains)',
      steps: [
        'Naver에서 비용/교통 중심 검색을 시작한다.',
        'Naver Map, Kakao Map, Daum 검색을 교차하면서 후보 데이터를 누적한다.',
        '1차 selector drift를 revise로 복구한다.',
        '2차 후보 우선순위 drift를 revise로 복구한다.',
        'VisitSeoul을 참고해 최종 후보군을 확정한다.'
      ],
      references: [
        'https://www.naver.com',
        'https://search.naver.com',
        'https://map.naver.com',
        'https://www.daum.net',
        'https://search.daum.net',
        'https://map.kakao.com',
        'https://korean.visitseoul.net/index'
      ]
    },
    run: async ({ page, scenarioDir, iteration }) => {
      let progress = 0;
      let firstSelectorDrift = true;
      let secondPriorityDrift = true;
      const decisionHistory: LoopDecision[] = [];
      const timeline: string[] = [];
      const scriptedActions: StepAction[] = [
        { kind: 'goto', target: 'https://www.naver.com' },
        { kind: 'type', target: 'input[name="query"]', value: '판교역 아이와 가볼만한곳 교통비' },
        { kind: 'press_enter', target: 'input[name="query"]' },
        {
          kind: 'goto',
          target:
            'https://search.naver.com/search.naver?query=%ED%8C%90%EA%B5%90%EC%97%AD%20%ED%82%A4%EC%A6%88%EC%B9%B4%ED%8E%98%20%EA%B0%80%EA%B2%A9'
        },
        {
          kind: 'goto',
          target:
            'https://map.naver.com/p/search/%ED%8C%90%EA%B5%90%EC%97%AD%20%ED%82%A4%EC%A6%88%EC%B9%B4%ED%8E%98'
        },
        {
          kind: 'goto',
          target:
            'https://map.naver.com/p/search/%ED%8C%90%EA%B5%90%20%EC%96%B4%EB%A6%B0%EC%9D%B4%EC%B1%85%EB%AF%B8%EC%88%A0%EA%B4%80'
        },
        { kind: 'goto', target: 'https://www.daum.net' },
        {
          kind: 'goto',
          target:
            'https://search.daum.net/search?w=tot&q=%ED%8C%90%EA%B5%90%EC%97%AD%20%EC%96%B4%EB%A6%B0%EC%9D%B4%EB%B0%95%EB%AC%BC%EA%B4%80%20%EC%A3%BC%EC%B0%A8'
        },
        {
          kind: 'goto',
          target:
            'https://map.kakao.com/?q=%ED%8C%90%EA%B5%90%EC%97%AD%20%EC%96%B4%EB%A6%B0%EC%9D%B4%20%EB%B0%95%EB%AC%BC%EA%B4%80'
        },
        {
          kind: 'goto',
          target:
            'https://search.naver.com/search.naver?query=%ED%8C%90%EA%B5%90%EC%97%AD%20%EA%B0%80%EC%A1%B1%20%EB%B8%8C%EB%9F%B0%EC%B9%98%20%EA%B0%80%EA%B2%A9'
        },
        {
          kind: 'goto',
          target:
            'https://map.naver.com/p/search/%ED%8C%90%EA%B5%90%EC%97%AD%20%EA%B0%80%EC%A1%B1%20%EB%B8%8C%EB%9F%B0%EC%B9%98'
        },
        { kind: 'goto', target: 'https://korean.visitseoul.net/index' },
        {
          kind: 'goto',
          target:
            'https://map.naver.com/p/search/%ED%8C%90%EA%B5%90%EC%97%AD%20%EA%B0%80%EC%A1%B1%20%EA%B3%B5%EC%9B%90'
        },
        {
          kind: 'goto',
          target:
            'https://map.naver.com/p/search/%ED%8C%90%EA%B5%90%EC%97%AD%20%EC%9A%B0%EC%B2%9C%20%EC%8B%A4%EB%82%B4%20%EB%86%80%EA%B1%B0%EB%A6%AC'
        }
      ];

      const result = await runAssistantlessChatE2E({
        goal: `Autonomous I (${iteration + 1}) - budget route with double revise`,
        llmWarmupSteps: 2,
        maxSteps: 20,
        captureScreenshot: async ({ step, stage }) => {
          const path = join(scenarioDir, `step-${pad2(step + 1)}-${stage}.png`);
          await captureScreenshotWithFallback(page, path);
          return path;
        },
        shareWithUser: async (snapshot) => {
          timeline.push(
            `| ${nowStamp()} | share | step=${snapshot.step + 1} stage=${snapshot.stage} status=${snapshot.status ?? 'na'} |`
          );
        },
        analyzeWithLlm: async () => scriptedActions[Math.min(progress, scriptedActions.length - 1)],
        decideWithRules: async () => scriptedActions[Math.min(progress, scriptedActions.length - 1)],
        detectWithVision: async () => ({
          model: 'yolo26l',
          target: progress >= 8 ? 'map.kakao.com' : 'map.naver.com',
          confidence: 0.83
        }),
        executeAction: async ({ action }) => {
          timeline.push(`| ${nowStamp()} | execute | progress=${progress} action=${action.kind}:${action.target ?? ''} |`);
          try {
            if (progress === 4 && firstSelectorDrift) {
              firstSelectorDrift = false;
              return {
                status: 'fail',
                reason: '초기 지도 후보 selector drift',
                userQuestion: 'selector drift를 revise 해서 계속할까요?'
              };
            }
            if (progress === 10 && secondPriorityDrift) {
              secondPriorityDrift = false;
              return {
                status: 'fail',
                reason: '가격 우선순위 drift',
                userQuestion: '가격 중심으로 우선순위를 revise 할까요?'
              };
            }

            await executeActionWithPlaywright(page, action, timeout);
            if (progress === 0) {
              await page.waitForSelector('input[name="query"]', { timeout });
            } else if (progress === 1) {
              const value = await page.inputValue('input[name="query"]');
              if (!value.includes('판교역')) {
                return { status: 'fail', reason: 'query missing pangyo', userQuestion: '검색어를 조정할까요?' };
              }
            } else if (progress === 2 || progress === 3 || progress === 9) {
              await page.waitForURL(/search\.naver\.com/, { timeout });
            } else if (progress === 4 || progress === 5 || progress === 10 || progress === 12 || progress === 13) {
              await page.waitForURL(/map\.naver\.com/, { timeout });
            } else if (progress === 6) {
              await page.waitForURL(/daum\.net/, { timeout });
            } else if (progress === 7) {
              await page.waitForURL(/search\.daum\.net/, { timeout });
            } else if (progress === 8) {
              await page.waitForURL(/map\.kakao\.com/, { timeout });
            } else if (progress === 11) {
              await page.waitForURL(/visitseoul\.net/, { timeout });
            }

            if (action.target?.includes('/search/') || action.target?.includes('query=') || action.target?.includes('q=')) {
              const keyword = decodeQueryKeyword(action.target);
              if (keyword) {
                timeline.push(`| ${nowStamp()} | budget-query | keyword=${keyword} |`);
              }
            }
            progress += 1;
            const done = progress >= scriptedActions.length;
            if (done) {
              timeline.push(`| ${nowStamp()} | summary | budget route planning complete with double revise recovery |`);
            }
            return { status: 'pass', done };
          } catch (error) {
            return {
              status: 'fail',
              reason: error instanceof Error ? error.message : String(error),
              userQuestion: '경로 수집 실패입니다. revise 후 계속할까요?'
            };
          }
        },
        askUserDecision: async ({ question }) => {
          const decision = chooseAutonomousDecision(question, decisionHistory);
          decisionHistory.push(decision);
          timeline.push(`| ${nowStamp()} | decision | question="${question}" decision=${decision} |`);
          return decision;
        }
      });

      writeScenarioArtifacts(scenarioDir, timeline, result);
      return result;
    }
  };

  return [scenarioA, scenarioB, scenarioC, scenarioD, scenarioE, scenarioF, scenarioG, scenarioH, scenarioI];
}

describe('autonomous batch kr live e2e', () => {
  it('is disabled unless RUN_AUTONOMOUS_BATCH_E2E=1', () => {
    expect(typeof RUN_AUTONOMOUS_BATCH_E2E).toBe('boolean');
  });
});

describe.runIf(RUN_AUTONOMOUS_BATCH_E2E)('autonomous batch kr live e2e - scenario folders', () => {
  it(
    `runs ${AUTONOMOUS_BATCH_ITERATIONS} iteration(s) fully-autonomous and records per-scenario folders`,
    async () => {
      const runRoot = makeRunRoot();
      const scenarios = buildScenarios(runtimeEnv.playwrightTimeoutMs);
      const rows: BatchRow[] = [];
      const { chromium } = await import('playwright');
      const browser = await chromium.launch({ headless: runtimeEnv.playwrightHeadless });

      try {
        for (let iteration = 0; iteration < AUTONOMOUS_BATCH_ITERATIONS; iteration += 1) {
          for (const scenario of scenarios) {
            const scenarioDir = join(runRoot, scenario.id, `iteration-${pad2(iteration + 1)}`);
            mkdirSync(scenarioDir, { recursive: true });

            const context = await browser.newContext({
              locale: 'ko-KR',
              timezoneId: 'Asia/Seoul'
            });
            const page = await context.newPage();
            const output = await scenario.run({ page, scenarioDir, iteration });

            const row: BatchRow = {
              scenarioId: scenario.id,
              iteration: iteration + 1,
              expectedStatus: scenario.expectedStatus,
              actualStatus: output.status,
              steps: output.steps,
              llmCalls: output.llmCalls,
              ruleCalls: output.ruleCalls,
              visionCalls: output.visionCalls,
              revisions: output.revisions,
              decisions: output.decisions,
              snapshotsShared: output.snapshotsShared,
              captchaYoloCalls: output.captchaYoloCalls,
              captchaVlmCalls: output.captchaVlmCalls,
              captchaLlmSolveCalls: output.captchaLlmSolveCalls,
              captchaRetries: output.captchaRetries,
              recordDir: scenarioDir
            };
            rows.push(row);

            writeFileSync(join(scenarioDir, 'summary.json'), JSON.stringify(row, null, 2), 'utf-8');
            await context.close();
          }
        }
      } finally {
        await browser.close();
      }

      const mismatches = rows.filter((row) => row.expectedStatus !== row.actualStatus);
      const stepFailures = rows.filter((row) => {
        const scenario = scenarios.find((item) => item.id === row.scenarioId);
        if (!scenario) return true;
        return row.steps < scenario.minSteps;
      });

      const summary = {
        runRoot,
        batchRoot: resolveBatchRoot(),
        projectRoot: PROJECT_ROOT,
        iterations: AUTONOMOUS_BATCH_ITERATIONS,
        scenarios: scenarios.length,
        totalRuns: rows.length,
        mismatches: mismatches.length,
        stepFailures: stepFailures.length,
        rows
      };
      writeFileSync(join(runRoot, 'summary.json'), JSON.stringify(summary, null, 2), 'utf-8');

      for (const scenario of scenarios) {
        const scenarioRoot = join(runRoot, scenario.id);
        mkdirSync(scenarioRoot, { recursive: true });
        const scenarioRows = rows.filter((row) => row.scenarioId === scenario.id);
        const scenarioSummary = {
          scenarioId: scenario.id,
          expectedStatus: scenario.expectedStatus,
          minSteps: scenario.minSteps,
          runs: scenarioRows.length,
          pass: scenarioRows.filter((row) => row.actualStatus === 'pass').length,
          blocked: scenarioRows.filter((row) => row.actualStatus === 'blocked').length,
          fail: scenarioRows.filter((row) => row.actualStatus === 'fail').length,
          rows: scenarioRows
        };
        writeFileSync(join(scenarioRoot, 'summary.json'), JSON.stringify(scenarioSummary, null, 2), 'utf-8');
        writeFileSync(
          join(scenarioRoot, 'summary.md'),
          buildScenarioSummaryMarkdown(scenario.id, scenarioRows),
          'utf-8'
        );
        writeFileSync(join(scenarioRoot, 'PLAN.md'), buildScenarioPlanMarkdown(scenario), 'utf-8');
        writeFileSync(join(scenarioRoot, 'WORKFLOW.md'), buildScenarioWorkflowMarkdown(scenario), 'utf-8');
        writeFileSync(
          join(scenarioRoot, 'FINAL-OPTIMIZED-RESULT.md'),
          buildFinalOptimizedResultMarkdown(scenarioRows),
          'utf-8'
        );
      }

      const summaryMd = [
        '# Autonomous Batch Summary',
        '',
        `- runRoot: ${runRoot}`,
        `- iterations: ${AUTONOMOUS_BATCH_ITERATIONS}`,
        `- scenarios: ${scenarios.length}`,
        `- totalRuns: ${rows.length}`,
        `- mismatches: ${mismatches.length}`,
        `- stepFailures: ${stepFailures.length}`,
        '',
        '| scenario | iteration | expected | actual | steps | llm | rule | vision | revisions | decisions |',
        '|---|---:|---|---|---:|---:|---:|---:|---:|---|',
        ...rows.map(
          (row) =>
            `| ${row.scenarioId} | ${row.iteration} | ${row.expectedStatus} | ${row.actualStatus} | ${row.steps} | ${row.llmCalls} | ${row.ruleCalls} | ${row.visionCalls} | ${row.revisions} | ${row.decisions.join(',')} |`
        )
      ].join('\n');
      writeFileSync(join(runRoot, 'summary.md'), summaryMd, 'utf-8');
      writeFileSync(join(runRoot, 'PLANNING.md'), buildRunPlanningMarkdown(scenarios), 'utf-8');
      writeFileSync(join(runRoot, 'WORKFLOW.md'), buildWorkflowMarkdown(scenarios), 'utf-8');
      writeFileSync(
        join(runRoot, 'FINAL-OPTIMIZED-RESULT.md'),
        buildFinalOptimizedResultMarkdown(rows),
        'utf-8'
      );

      expect(existsSync(join(runRoot, 'summary.json'))).toBe(true);
      expect(existsSync(join(runRoot, 'summary.md'))).toBe(true);
      expect(existsSync(join(runRoot, 'PLANNING.md'))).toBe(true);
      expect(existsSync(join(runRoot, 'WORKFLOW.md'))).toBe(true);
      expect(existsSync(join(runRoot, 'FINAL-OPTIMIZED-RESULT.md'))).toBe(true);
      for (const scenario of scenarios) {
        const scenarioRoot = join(runRoot, scenario.id);
        expect(existsSync(join(scenarioRoot, 'summary.json'))).toBe(true);
        expect(existsSync(join(scenarioRoot, 'summary.md'))).toBe(true);
        expect(existsSync(join(scenarioRoot, 'PLAN.md'))).toBe(true);
        expect(existsSync(join(scenarioRoot, 'WORKFLOW.md'))).toBe(true);
        expect(existsSync(join(scenarioRoot, 'FINAL-OPTIMIZED-RESULT.md'))).toBe(true);
      }
      expect(rows.length).toBe(AUTONOMOUS_BATCH_ITERATIONS * scenarios.length);
      expect(mismatches).toHaveLength(0);
      expect(stepFailures).toHaveLength(0);
    },
    E2E_TIMEOUT_MS
  );
});
