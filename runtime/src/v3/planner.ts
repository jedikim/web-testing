import type { ScreenState, StepActionType, StepPlan } from './types';

export interface PlannerImageInput {
  mimeType: string;
  bytesBase64: string;
}

export interface PlannerGenerateInput {
  prompt: string;
  image: PlannerImageInput;
}

export interface PlannerModelClient {
  generate(input: PlannerGenerateInput): Promise<string>;
}

export interface PlannerOptions {
  model: PlannerModelClient;
}

export interface PlannerResult {
  screenState: ScreenState;
  steps: StepPlan[];
}

interface RawPlannerStep {
  action_type?: unknown;
  target_description?: unknown;
  value?: unknown;
  keyword_weights?: unknown;
  target_viewport_xy?: unknown;
  expected_result?: unknown;
}

interface RawPlannerPayload {
  screen_state?: {
    has_obstacle?: unknown;
    obstacle_type?: unknown;
    obstacle_close_xy?: unknown;
    obstacle_description?: unknown;
  };
  steps?: unknown;
}

function normalizePromptTask(task: string): string {
  return task.replace(/\s+/g, ' ').trim();
}

function extractJsonBlock(raw: string): string {
  const fenced = raw.match(/```json\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }
  return raw.trim();
}

function toNumber(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }
  return value;
}

function normalizeXY(raw: unknown): [number, number] | undefined {
  if (!Array.isArray(raw) || raw.length < 2) {
    return undefined;
  }
  const x = toNumber(raw[0]);
  const y = toNumber(raw[1]);
  if (x === undefined || y === undefined) {
    return undefined;
  }
  const clampedX = Math.max(0, Math.min(1, x));
  const clampedY = Math.max(0, Math.min(1, y));
  return [clampedX, clampedY];
}

function sanitizeActionType(raw: unknown): StepActionType {
  if (raw === 'click' || raw === 'type' || raw === 'wait' || raw === 'navigate' || raw === 'summarize') {
    return raw;
  }
  return 'click';
}

function tokenizeForWeights(raw: string): string[] {
  return Array.from(
    new Set(
      raw
        .toLowerCase()
        .match(/[0-9a-zA-Z가-힣]+/g)
        ?.filter((token) => token.length >= 2) ?? []
    )
  ).slice(0, 6);
}

function normalizeKeywordWeights(raw: unknown, targetDescription: string): Record<string, number> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const out: Record<string, number> = {};
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      const score = toNumber(value);
      if (!score || score <= 0) {
        continue;
      }
      out[String(key)] = Math.min(1, Math.max(0.05, score));
    }
    if (Object.keys(out).length > 0) {
      return out;
    }
  }

  const tokens = tokenizeForWeights(targetDescription);
  if (tokens.length === 0) {
    return { click: 0.4 };
  }
  const base = Number((1 / tokens.length).toFixed(3));
  const out: Record<string, number> = {};
  for (const token of tokens) {
    out[token] = base;
  }
  return out;
}

function normalizeScreenState(raw: RawPlannerPayload['screen_state']): ScreenState {
  const hasObstacle = Boolean(raw?.has_obstacle);
  return {
    hasObstacle,
    obstacleType: typeof raw?.obstacle_type === 'string' ? raw.obstacle_type : undefined,
    obstacleCloseXY: normalizeXY(raw?.obstacle_close_xy),
    obstacleDescription: typeof raw?.obstacle_description === 'string' ? raw.obstacle_description : undefined
  };
}

function normalizeSteps(raw: unknown): StepPlan[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .map((row, index) => {
      const step = (row ?? {}) as RawPlannerStep;
      const targetDescription =
        typeof step.target_description === 'string' && step.target_description.trim().length > 0
          ? step.target_description.trim()
          : `step-${index + 1}`;
      return {
        stepIndex: index + 1,
        actionType: sanitizeActionType(step.action_type),
        targetDescription,
        value: typeof step.value === 'string' ? step.value : undefined,
        keywordWeights: normalizeKeywordWeights(step.keyword_weights, targetDescription),
        targetViewportXY: normalizeXY(step.target_viewport_xy),
        expectedResult: typeof step.expected_result === 'string' ? step.expected_result : undefined
      } satisfies StepPlan;
    })
    .filter((row) => row.targetDescription.length > 0);
}

export function buildPlannerPrompt(task: string): string {
  const normalizedTask = normalizePromptTask(task);
  return [
    '당신은 웹 자동화 Planner입니다. 반드시 JSON만 출력하세요.',
    '순서:',
    '1) screen_state 분석 (장애물 여부, 종류, 닫기 좌표)',
    '2) task를 실행 스텝으로 분해',
    '각 step은 action_type, target_description, keyword_weights, target_viewport_xy, expected_result를 포함',
    'expected_result 형식:',
    '- URL 변경: /path',
    '- DOM 존재: .selector',
    '- 화면 변화',
    `task: ${normalizedTask}`,
    'response schema:',
    '{"screen_state":{"has_obstacle":bool,"obstacle_type":"...","obstacle_close_xy":[x,y],"obstacle_description":"..."},"steps":[{"action_type":"click|type|wait|navigate|summarize","target_description":"...","value":"...","keyword_weights":{"keyword":0.0},"target_viewport_xy":[0.0,0.0],"expected_result":"..."}]}'
  ].join('\n');
}

export class Planner {
  private readonly model: PlannerModelClient;

  constructor(options: PlannerOptions) {
    this.model = options.model;
  }

  async plan(task: string, screenshot: PlannerImageInput): Promise<PlannerResult> {
    const prompt = buildPlannerPrompt(task);
    const raw = await this.model.generate({
      prompt,
      image: screenshot
    });

    const payloadText = extractJsonBlock(raw);
    let parsed: RawPlannerPayload;
    try {
      parsed = JSON.parse(payloadText) as RawPlannerPayload;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`planner returned invalid json: ${message}`);
    }

    const screenState = normalizeScreenState(parsed.screen_state);
    const steps = normalizeSteps(parsed.steps);
    if (steps.length === 0) {
      throw new Error('planner returned no executable steps');
    }
    return { screenState, steps };
  }
}
