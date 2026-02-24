import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { loadEnvFiles } from '../src/config/load-env-file';
import { loadRuntimeEnv } from '../src/config/env';
import { runAssistantlessChatE2E, type AssistantlessChatE2EOutput, type StepAction } from '../src/testing/assistantless-chat-e2e';

interface LiveScenarioResult {
  scenarioId: string;
  iteration: number;
  expectedStatus: 'pass' | 'blocked';
  actualStatus: 'pass' | 'fail' | 'blocked';
  llmCalls: number;
  ruleCalls: number;
  visionCalls: number;
  revisions: number;
  decisions: string[];
  snapshotsShared: number;
  reportPath: string;
}

interface LiveScenarioContext {
  scenarioId: string;
  page: import('playwright').Page;
  iteration: number;
}

interface ScenarioDefinition {
  id: string;
  expectedStatus: 'pass' | 'blocked';
  run: (ctx: LiveScenarioContext) => Promise<AssistantlessChatE2EOutput>;
}

const TEST_DIR = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = resolve(TEST_DIR, '..', '..');
loadEnvFiles({ cwd: REPO_ROOT, filenames: ['runtime/.env', '.env'] });

const runtimeEnv = loadRuntimeEnv({
  PW_HEADLESS: process.env.PW_HEADLESS,
  PLAYWRIGHT_TIMEOUT_MS: process.env.PLAYWRIGHT_TIMEOUT_MS,
  ARTIFACT_ROOT: process.env.ARTIFACT_ROOT
});

const RUN_ASSISTANTLESS_KR_E2E =
  process.env.RUN_ASSISTANTLESS_KR_E2E === '1' || process.env.RUN_KR_E2E === '1';

function parseIterations(raw: string | undefined): number {
  if (!raw) {
    return 1;
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 1) {
    return 1;
  }
  return Math.min(Math.floor(value), 5);
}

const ASSISTANTLESS_KR_ITERATIONS = parseIterations(process.env.ASSISTANTLESS_KR_ITERATIONS);
const E2E_TIMEOUT_MS = Math.max(runtimeEnv.playwrightTimeoutMs * 12, 120000);

function createArtifactsDir(day: string): string {
  const dir = resolve(REPO_ROOT, runtimeEnv.artifactRoot, 'e2e-assistantless', day);
  mkdirSync(dir, { recursive: true });
  return dir;
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

async function executePageAction(
  page: import('playwright').Page,
  action: StepAction,
  timeout: number
): Promise<void> {
  if (action.kind === 'goto') {
    if (!action.target) {
      throw new Error('goto action requires target url');
    }
    await page.goto(action.target, { waitUntil: 'domcontentloaded', timeout });
    return;
  }
  if (action.kind === 'type') {
    if (!action.target) {
      throw new Error('type action requires selector target');
    }
    await page.waitForSelector(action.target, { timeout });
    await page.fill(action.target, action.value ?? '');
    return;
  }
  if (action.kind === 'click') {
    if (!action.target) {
      throw new Error('click action requires selector target');
    }
    await page.waitForSelector(action.target, { timeout });
    await page.click(action.target, { timeout });
    return;
  }
  if (action.kind === 'press_enter') {
    if (action.target) {
      await page.waitForSelector(action.target, { timeout });
      await page.press(action.target, 'Enter', { timeout });
    } else {
      await page.keyboard.press('Enter');
    }
    return;
  }
  if (action.kind === 'checkpoint') {
    return;
  }
  throw new Error(`unsupported action kind: ${action.kind}`);
}

function buildComplexScenarios(timeout: number): ScenarioDefinition[] {
  const naverReviseScenario: ScenarioDefinition = {
    id: 'assistantless_naver_weather_revise',
    expectedStatus: 'pass',
    run: async ({ scenarioId, page, iteration }) => {
      let progress = 0;
      let failureInjected = false;
      let revised = false;
      let decisionAsked = false;
      const scenarioDay = new Date().toISOString().slice(0, 10);
      const artifactsDir = createArtifactsDir(scenarioDay);

      return runAssistantlessChatE2E({
        goal: `KR live: naver weather revise (${iteration + 1})`,
        llmWarmupSteps: 2,
        maxSteps: 6,
        captureScreenshot: async ({ step, stage }) => {
          const stamp = new Date().toISOString().replace(/[:.]/g, '-');
          const path = join(
            artifactsDir,
            `${stamp}_${scenarioId}_it${iteration + 1}_step${step + 1}_${stage}.png`
          );
          await captureScreenshotWithFallback(page, path);
          return path;
        },
        shareWithUser: async () => undefined,
        analyzeWithLlm: async () => {
          if (progress === 0) {
            return { kind: 'goto', target: 'https://www.naver.com' };
          }
          if (progress === 1 && !failureInjected) {
            failureInjected = true;
            return { kind: 'type', target: 'input[name="q"]', value: '날씨' };
          }
          if (progress === 1) {
            return { kind: 'type', target: 'input[name="query"]', value: '날씨' };
          }
          return { kind: 'press_enter', target: 'input[name="query"]' };
        },
        decideWithRules: async () => {
          if (progress === 0) {
            return { kind: 'goto', target: 'https://www.naver.com' };
          }
          if (progress === 1) {
            return { kind: 'type', target: 'input[name="query"]', value: '날씨' };
          }
          return { kind: 'press_enter', target: 'input[name="query"]' };
        },
        detectWithVision: async () => ({
          model: 'yolo26n',
          target: 'input[name="query"]',
          confidence: 0.9
        }),
        executeAction: async ({ action }) => {
          try {
            if (progress === 0) {
              await executePageAction(page, action, timeout);
              await page.waitForSelector('input[name="query"]', { timeout });
              progress += 1;
              return { status: 'pass', done: false };
            }

            if (progress === 1) {
              if (action.target !== 'input[name="query"]') {
                return {
                  status: 'fail',
                  reason: 'selector drift on search input',
                  userQuestion: '검색 입력창 selector를 수정해서 다시 진행할까요?'
                };
              }
              await executePageAction(page, action, timeout);
              const value = await page.inputValue('input[name="query"]');
              if (!value.includes('날씨')) {
                return {
                  status: 'fail',
                  reason: `query mismatch: ${value}`,
                  userQuestion: '입력값이 다릅니다. revise 후 재시도할까요?'
                };
              }
              progress += 1;
              return { status: 'pass', done: false };
            }

            await executePageAction(page, action, timeout);
            await page.waitForURL(/search\.naver\.com/, { timeout });
            if (!page.url().includes('query=')) {
              return {
                status: 'fail',
                reason: 'search url missing query',
                userQuestion: '결과 URL 검증이 실패했습니다. revise 할까요?'
              };
            }
            const body = (await page.textContent('body')) ?? '';
            if (!body.includes('날씨')) {
              return {
                status: 'fail',
                reason: 'weather keyword not visible',
                userQuestion: '검색 결과 검증이 실패했습니다. revise 할까요?'
              };
            }
            progress += 1;
            return { status: 'pass', done: true };
          } catch (error) {
            return {
              status: 'fail',
              reason: error instanceof Error ? error.message : String(error),
              userQuestion: '실행 오류가 발생했습니다. revise 후 재시도할까요?'
            };
          }
        },
        askUserDecision: async () => {
          if (!decisionAsked) {
            decisionAsked = true;
            revised = true;
            return 'revise';
          }
          return revised ? 'go' : 'revise';
        }
      });
    }
  };

  const daumRuleScenario: ScenarioDefinition = {
    id: 'assistantless_daum_news_rulefirst',
    expectedStatus: 'pass',
    run: async ({ scenarioId, page, iteration }) => {
      let progress = 0;
      const scenarioDay = new Date().toISOString().slice(0, 10);
      const artifactsDir = createArtifactsDir(scenarioDay);

      return runAssistantlessChatE2E({
        goal: `KR live: daum news rule-first (${iteration + 1})`,
        llmWarmupSteps: 1,
        maxSteps: 6,
        captureScreenshot: async ({ step, stage }) => {
          const stamp = new Date().toISOString().replace(/[:.]/g, '-');
          const path = join(
            artifactsDir,
            `${stamp}_${scenarioId}_it${iteration + 1}_step${step + 1}_${stage}.png`
          );
          await captureScreenshotWithFallback(page, path);
          return path;
        },
        shareWithUser: async () => undefined,
        analyzeWithLlm: async () => ({ kind: 'goto', target: 'https://www.daum.net' }),
        decideWithRules: async () => {
          if (progress === 0) {
            return { kind: 'goto', target: 'https://www.daum.net' };
          }
          if (progress === 1) {
            return { kind: 'type', target: 'input[name="q"]', value: '뉴스' };
          }
          return { kind: 'press_enter', target: 'input[name="q"]' };
        },
        executeAction: async ({ action }) => {
          try {
            if (progress === 0) {
              await executePageAction(page, action, timeout);
              await page.waitForSelector('input[name="q"]', { timeout });
              progress += 1;
              return { status: 'pass', done: false };
            }
            if (progress === 1) {
              await executePageAction(page, action, timeout);
              const value = await page.inputValue('input[name="q"]');
              if (!value.includes('뉴스')) {
                return {
                  status: 'fail',
                  reason: `query mismatch: ${value}`,
                  userQuestion: '검색어가 맞지 않습니다. revise 할까요?'
                };
              }
              progress += 1;
              return { status: 'pass', done: false };
            }

            await executePageAction(page, action, timeout);
            await page.waitForURL(/search\.daum\.net/, { timeout });
            const body = (await page.textContent('body')) ?? '';
            if (!body.includes('뉴스')) {
              return {
                status: 'fail',
                reason: 'news keyword missing on page',
                userQuestion: '결과가 예상과 다릅니다. revise 할까요?'
              };
            }
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
        askUserDecision: async () => 'revise'
      });
    }
  };

  const sensitiveBlockScenario: ScenarioDefinition = {
    id: 'assistantless_sensitive_not_go_block',
    expectedStatus: 'blocked',
    run: async ({ scenarioId, page, iteration }) => {
      let progress = 0;
      const scenarioDay = new Date().toISOString().slice(0, 10);
      const artifactsDir = createArtifactsDir(scenarioDay);

      return runAssistantlessChatE2E({
        goal: `KR live: sensitive action handoff (${iteration + 1})`,
        llmWarmupSteps: 1,
        maxSteps: 4,
        captureScreenshot: async ({ step, stage }) => {
          const stamp = new Date().toISOString().replace(/[:.]/g, '-');
          const path = join(
            artifactsDir,
            `${stamp}_${scenarioId}_it${iteration + 1}_step${step + 1}_${stage}.png`
          );
          await captureScreenshotWithFallback(page, path);
          return path;
        },
        shareWithUser: async () => undefined,
        analyzeWithLlm: async () => ({ kind: 'goto', target: 'https://www.naver.com' }),
        decideWithRules: async () => ({ kind: 'checkpoint', target: 'login-entry' }),
        executeAction: async ({ action }) => {
          try {
            if (progress === 0) {
              await executePageAction(page, action, timeout);
              await page.waitForSelector('body', { timeout });
              progress += 1;
              return { status: 'pass', done: false };
            }

            if (action.kind === 'checkpoint') {
              return {
                status: 'fail',
                reason: 'sensitive action requires explicit user approval',
                userQuestion: '로그인 진입을 계속할까요?'
              };
            }

            return {
              status: 'fail',
              reason: 'unexpected action after checkpoint',
              userQuestion: '예상치 못한 흐름입니다. 중단할까요?'
            };
          } catch (error) {
            return {
              status: 'fail',
              reason: error instanceof Error ? error.message : String(error),
              userQuestion: '실행 오류가 발생했습니다. 중단할까요?'
            };
          }
        },
        askUserDecision: async () => 'not_go'
      });
    }
  };

  const captchaEscalationScenario: ScenarioDefinition = {
    id: 'assistantless_captcha_escalation_retry',
    expectedStatus: 'pass',
    run: async ({ scenarioId, page, iteration }) => {
      let progress = 0;
      let yoloDetected = false;
      const scenarioDay = new Date().toISOString().slice(0, 10);
      const artifactsDir = createArtifactsDir(scenarioDay);

      return runAssistantlessChatE2E({
        goal: `KR live: captcha escalation retry (${iteration + 1})`,
        llmWarmupSteps: 1,
        maxSteps: 4,
        captchaMaxRetries: 3,
        captureScreenshot: async ({ step, stage }) => {
          const stamp = new Date().toISOString().replace(/[:.]/g, '-');
          const path = join(
            artifactsDir,
            `${stamp}_${scenarioId}_it${iteration + 1}_step${step + 1}_${stage}.png`
          );
          await captureScreenshotWithFallback(page, path);
          return path;
        },
        shareWithUser: async () => undefined,
        analyzeWithLlm: async () => ({ kind: 'goto', target: 'https://www.naver.com' }),
        decideWithRules: async () => ({ kind: 'goto', target: 'https://www.naver.com' }),
        detectCaptchaWithYolo: async () => {
          if (!yoloDetected) {
            yoloDetected = true;
            return { detected: true, confidence: 0.8, label: 'captcha' };
          }
          return { detected: false };
        },
        confirmCaptchaWithVlm: async () => ({
          confirmed: true,
          reason: 'captcha gate identified'
        }),
        solveCaptchaWithLlm: async ({ attempt }) => ({
          solved: true,
          action: { kind: 'click', target: 'body', value: `attempt-${attempt}` }
        }),
        executeCaptchaSolveAction: async () => true,
        verifyCaptchaCleared: async ({ attempt }) => attempt >= 2,
        executeAction: async ({ action }) => {
          try {
            if (progress === 0) {
              await executePageAction(page, action, timeout);
              await page.waitForSelector('body', { timeout });
              progress += 1;
              return { status: 'pass', done: true };
            }
            return { status: 'pass', done: true };
          } catch (error) {
            return {
              status: 'fail',
              reason: error instanceof Error ? error.message : String(error),
              userQuestion: '캡차 이후 액션 검증 실패. revise 할까요?'
            };
          }
        },
        askUserDecision: async () => 'revise'
      });
    }
  };

  return [naverReviseScenario, daumRuleScenario, sensitiveBlockScenario, captchaEscalationScenario];
}

describe('assistantless kr live e2e', () => {
  it('is disabled unless RUN_ASSISTANTLESS_KR_E2E=1', () => {
    expect(typeof RUN_ASSISTANTLESS_KR_E2E).toBe('boolean');
  });
});

describe.runIf(RUN_ASSISTANTLESS_KR_E2E)('assistantless kr live e2e - complex iterative scenarios', () => {
  it(
    `runs ${ASSISTANTLESS_KR_ITERATIONS} iteration(s) with complex real-world chat-loop scenarios`,
    async () => {
      const { chromium } = await import('playwright');
      const browser = await chromium.launch({ headless: runtimeEnv.playwrightHeadless });
      const rows: LiveScenarioResult[] = [];

      try {
        for (let iteration = 0; iteration < ASSISTANTLESS_KR_ITERATIONS; iteration += 1) {
          const scenarios = buildComplexScenarios(runtimeEnv.playwrightTimeoutMs);

          for (const scenario of scenarios) {
            const context = await browser.newContext({
              locale: 'ko-KR',
              timezoneId: 'Asia/Seoul'
            });
            const page = await context.newPage();
            const output = await scenario.run({
              scenarioId: scenario.id,
              page,
              iteration
            });

            const startedAt = new Date();
            const day = startedAt.toISOString().slice(0, 10);
            const stamp = startedAt.toISOString().replace(/[:.]/g, '-');
            const artifactsDir = createArtifactsDir(day);
            const reportPath = join(
              artifactsDir,
              `${stamp}_${scenario.id}_it${iteration + 1}_report.json`
            );

            const row: LiveScenarioResult = {
              scenarioId: scenario.id,
              iteration: iteration + 1,
              expectedStatus: scenario.expectedStatus,
              actualStatus: output.status,
              llmCalls: output.llmCalls,
              ruleCalls: output.ruleCalls,
              visionCalls: output.visionCalls,
              revisions: output.revisions,
              decisions: output.decisions,
              snapshotsShared: output.snapshotsShared,
              reportPath
            };
            rows.push(row);

            writeFileSync(reportPath, JSON.stringify(row, null, 2), 'utf-8');
            await context.close();
          }
        }
      } finally {
        await browser.close();
      }

      const mismatches = rows.filter((row) => row.expectedStatus !== row.actualStatus);
      const summaryDay = new Date().toISOString().slice(0, 10);
      const summaryDir = createArtifactsDir(summaryDay);
      const summaryPath = join(
        summaryDir,
        `${new Date().toISOString().replace(/[:.]/g, '-')}_assistantless-live-summary.json`
      );
      writeFileSync(
        summaryPath,
        JSON.stringify(
          {
            iterations: ASSISTANTLESS_KR_ITERATIONS,
            totalScenarios: rows.length,
            mismatches: mismatches.length,
            rows
          },
          null,
          2
        ),
        'utf-8'
      );

      expect(rows.length).toBeGreaterThanOrEqual(ASSISTANTLESS_KR_ITERATIONS * 4);
      expect(mismatches).toHaveLength(0);
      expect(rows.filter((row) => row.actualStatus === 'pass').length).toBeGreaterThan(0);
      expect(rows.filter((row) => row.actualStatus === 'blocked').length).toBeGreaterThan(0);
    },
    E2E_TIMEOUT_MS
  );
});
