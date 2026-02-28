import { ActionCache, PlanCache } from './cache';
import type { DOMExtractClient } from './dom-extractor';
import { DOMExtractor } from './dom-extractor';
import { ElementFilter } from './element-filter';
import { Actor } from './actor';
import { Executor, type ExecutorBrowser } from './executor';
import { Planner, type PlannerImageInput } from './planner';
import { ResultVerifier } from './result-verifier';
import type { Action, CacheEntry, StepPlan } from './types';

export interface OrchestratorRuntime extends ExecutorBrowser {
  getUrl(): Promise<string>;
  getDomain(): Promise<string>;
  getPlannerImage(): Promise<PlannerImageInput>;
  getVisualHash(): Promise<string>;
  domExists(selector: string): Promise<boolean>;
  wait(ms: number): Promise<void>;
  getDOMClient(): DOMExtractClient;
}

export interface OrchestratorOptions {
  planner: Planner;
  extractor?: DOMExtractor;
  filter?: ElementFilter;
  actor?: Actor;
  executor?: Executor;
  verifier?: ResultVerifier;
  actionCache?: ActionCache;
  planCache?: PlanCache;
  filterScoreThreshold?: number;
}

export interface StepExecutionTrace {
  stepIndex: number;
  targetDescription: string;
  usedPlanCache: boolean;
  usedActionCache: boolean;
  verification: 'ok' | 'wrong' | 'failed';
}

export interface OrchestratorRunResult {
  ok: boolean;
  usedPlanCache: boolean;
  traces: StepExecutionTrace[];
}

export class Orchestrator {
  private readonly planner: Planner;
  private readonly extractor: DOMExtractor;
  private readonly filter: ElementFilter;
  private readonly actor: Actor;
  private readonly executor: Executor;
  private readonly verifier: ResultVerifier;
  private readonly actionCache: ActionCache;
  private readonly planCache: PlanCache;
  private readonly filterScoreThreshold: number;

  constructor(options: OrchestratorOptions) {
    this.planner = options.planner;
    this.extractor = options.extractor ?? new DOMExtractor();
    this.filter = options.filter ?? new ElementFilter();
    this.actor = options.actor ?? new Actor();
    this.executor = options.executor ?? new Executor();
    this.verifier = options.verifier ?? new ResultVerifier();
    this.actionCache = options.actionCache ?? new ActionCache();
    this.planCache = options.planCache ?? new PlanCache();
    this.filterScoreThreshold = options.filterScoreThreshold ?? 0.5;
  }

  async run(task: string, runtime: OrchestratorRuntime): Promise<OrchestratorRunResult> {
    const domain = await runtime.getDomain();
    const cachedPlan = this.planCache.lookup(domain, task);
    const usedPlanCache = Boolean(cachedPlan);
    const steps = cachedPlan ?? (await this.plan(task, domain, runtime));

    const traces: StepExecutionTrace[] = [];
    for (const step of steps) {
      const trace = await this.executeStep(step, runtime, domain, usedPlanCache);
      traces.push(trace);
      if (trace.verification !== 'ok') {
        return {
          ok: false,
          usedPlanCache,
          traces
        };
      }
    }

    return {
      ok: true,
      usedPlanCache,
      traces
    };
  }

  private async plan(task: string, domain: string, runtime: OrchestratorRuntime): Promise<StepPlan[]> {
    const plannerImage = await runtime.getPlannerImage();
    const planned = await this.planner.plan(task, plannerImage);
    this.planCache.store(domain, task, planned.steps);
    return planned.steps;
  }

  private async executeStep(
    step: StepPlan,
    runtime: OrchestratorRuntime,
    domain: string,
    usedPlanCache: boolean
  ): Promise<StepExecutionTrace> {
    const preUrl = await runtime.getUrl();
    const preVisualHash = await runtime.getVisualHash();

    const cached = this.actionCache.lookup({
      domain,
      url: preUrl,
      taskType: step.targetDescription
    });

    let action: Action;
    let usedActionCache = false;
    if (cached) {
      action = this.actionCache.toAction(cached);
      usedActionCache = true;
    } else {
      const nodes = await this.extractor.extract(runtime.getDOMClient());
      const candidates = this.filter.filter(nodes, step.keywordWeights, 20);
      if ((candidates[0]?.score ?? 0) >= this.filterScoreThreshold) {
        action = await this.actor.decide(step, candidates);
      } else {
        action = {
          selector: null,
          actionType: step.actionType,
          value: step.value,
          viewportXY: step.targetViewportXY
        };
      }
    }

    await this.executor.executeAction(action, runtime);
    await runtime.wait(300);

    const postUrl = await runtime.getUrl();
    const postVisualHash = await runtime.getVisualHash();
    const verification = await this.verifier.verify({
      expectedResult: step.expectedResult,
      preUrl,
      postUrl,
      preVisualHash,
      postVisualHash,
      domExists: (selector) => runtime.domExists(selector),
      expectedVisualHash: cached?.postScreenshotPhash
    });

    if (verification === 'ok') {
      const entry: CacheEntry = {
        domain,
        urlPattern: preUrl,
        taskType: step.targetDescription,
        selector: action.selector,
        actionType: action.actionType,
        value: action.value,
        keywordWeights: step.keywordWeights,
        viewportXY: action.viewportXY,
        viewportBbox: action.viewportBbox,
        expectedResult: step.expectedResult,
        postScreenshotPhash: postVisualHash,
        successCount: 1
      };
      this.actionCache.store(entry);
    }

    return {
      stepIndex: step.stepIndex,
      targetDescription: step.targetDescription,
      usedPlanCache,
      usedActionCache,
      verification
    };
  }
}
