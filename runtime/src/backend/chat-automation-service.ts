import { EventEmitter } from 'node:events';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

import { PlanCache, type PlanCacheStep } from '../learning/plan-cache';
import { CHAT_ACTION_PLANNER_PROMPT_V1 } from '../prompts/chat-action-planner';
import { CHAT_RESULT_VALIDATOR_PROMPT_V1 } from '../prompts/chat-result-validator';
import { CHAT_SUMMARY_FORMATTER_PROMPT_V1 } from '../prompts/chat-summary-formatter';
import { CHAT_TASK_ANALYZER_PROMPT_V1 } from '../prompts/chat-task-analyzer';
import { promptTag } from '../prompts/types';
import { SessionStore } from '../session/store';
import type { AddSessionTurnInput, AutomationSession, CreateSessionInput, SessionTurn } from '../session/types';
import { getLangfuseTelemetry, type LangfuseTelemetry, type ManagedTelemetrySpan } from '../telemetry/langfuse';
import { ChatPlaywrightDriver, type ActionObjective } from './chat-playwright-driver';

export type BrowserMode = 'headful' | 'headless';
export type ChatAutomationExecutionMode = 'simulate' | 'playwright';

export type ChatAutomationRunStatus =
  | 'idle'
  | 'running'
  | 'paused'
  | 'waiting_captcha'
  | 'completed'
  | 'failed'
  | 'canceled';

export type ChatAutomationLogLevel = 'info' | 'warn' | 'error';

export interface ChatAutomationLogEntry {
  id: string;
  at: string;
  level: ChatAutomationLogLevel;
  message: string;
}

export interface ChatAutomationTask {
  id: string;
  content: string;
  browserMode: BrowserMode;
  requestedAt: string;
  attachments: ChatMessageAttachment[];
}

export interface ChatAutomationRunState {
  runId?: string;
  status: ChatAutomationRunStatus;
  browserMode?: BrowserMode;
  step: number;
  totalSteps: number;
  currentStepTitle?: string;
  startedAt?: string;
  updatedAt: string;
  lastMessage?: string;
  lastError?: string;
  waitingCaptcha: boolean;
  captchaPrompt?: string;
  queueLength: number;
  planCacheHit?: boolean;
  planCacheScore?: number;
  planTemplateId?: string;
}

export interface ChatAutomationSessionSnapshot {
  schemaVersion: 'chat.session.snapshot.v1';
  emittedAt: string;
  session: AutomationSession;
  run: ChatAutomationRunState;
  logs: ChatAutomationLogEntry[];
  handoffs: ChatAutomationHandoff[];
  latestScreenshot?: ChatAutomationScreenshotRef;
  screenshotHistory?: ChatAutomationScreenshotRef[];
}

export interface ChatAutomationProgressEvent {
  schemaVersion: 'chat.progress.event.v1';
  eventType: 'session_snapshot';
  emittedAt: string;
  sessionId: string;
  operatorId: string;
  runStatus: ChatAutomationRunStatus;
  snapshot: ChatAutomationSessionSnapshot;
}

export interface ChatAutomationSessionSummary {
  sessionId: string;
  title?: string;
  operatorId: string;
  runStatus: ChatAutomationRunStatus;
  browserMode?: BrowserMode;
  updatedAt: string;
  queueLength: number;
}

export type ChatAutomationHandoffType = 'captcha' | 'security_challenge';

export type ChatAutomationHandoffStatus = 'waiting' | 'resolved' | 'canceled';

export interface ChatAutomationHandoff {
  id: string;
  type: ChatAutomationHandoffType;
  status: ChatAutomationHandoffStatus;
  prompt: string;
  requestedAt: string;
  resolvedAt?: string;
  valueLength?: number;
}

export interface ChatAutomationScreenshotRef {
  path: string;
  source: 'attachment' | 'turn_screenshot' | 'runtime';
  capturedAt: string;
  label?: string;
}

export interface SendMessageInput {
  sessionId: string;
  content: string;
  browserMode: BrowserMode;
  operatorId?: string;
  autoPauseOthers?: boolean;
  attachments?: ChatMessageAttachmentInput[];
}

export interface CreateChatSessionInput {
  title?: string;
  workflowId?: string;
  tags?: string[];
  operatorId?: string;
  metadata?: Record<string, unknown>;
  systemPrompt?: string;
}

export interface SubmitCaptchaInput {
  sessionId: string;
  value: string;
}

export interface ResolveHandoffInput {
  sessionId: string;
  handoffId: string;
  actionTaken: string;
  value?: string;
  resolvedBy?: string;
  metadata?: Record<string, unknown>;
}

export interface ChatAutomationServiceOptions {
  store: SessionStore;
  stepDelayMs?: number;
  logTailSize?: number;
  planCacheEnabled?: boolean;
  planCacheSimilarityThreshold?: number;
  executionMode?: ChatAutomationExecutionMode;
  runtimeScreenshotRoot?: string;
}

export type ChatMessageAttachmentSource = 'upload' | 'url' | 'path';

export interface ChatMessageAttachment {
  name: string;
  mimeType?: string;
  source: ChatMessageAttachmentSource;
  path?: string;
  url?: string;
  sizeBytes?: number;
}

export interface ChatMessageAttachmentInput {
  name?: string;
  mimeType?: string;
  source?: ChatMessageAttachmentSource;
  path?: string;
  url?: string;
  sizeBytes?: number;
}

interface SessionRuntimeState {
  sessionId: string;
  operatorId: string;
  run: ChatAutomationRunState;
  queue: ChatAutomationTask[];
  logs: ChatAutomationLogEntry[];
  workerRunning: boolean;
  paused: boolean;
  canceled: boolean;
  pendingCaptchaValue?: string;
  handoffs: ChatAutomationHandoff[];
  latestScreenshot?: ChatAutomationScreenshotRef;
  screenshotHistory: ChatAutomationScreenshotRef[];
  activePlanTemplateId?: string;
  latestSummary?: string;
  latestSummaryLowConfidence?: boolean;
  latestValidationMissingConstraints?: string[];
  latestValidationReason?: string;
  runSpan?: ManagedTelemetrySpan;
}

interface RuntimeStep {
  kind:
    | 'analysis'
    | 'browser'
    | 'navigate'
    | 'attachment_analysis'
    | 'image_search'
    | 'captcha'
    | 'listing'
    | 'verify';
  title: string;
}

interface TaskIntent {
  wantsSummary: boolean;
  wantsListingNavigation: boolean;
  explicitCategoryNavigation: boolean;
  listingPathHints: string[];
  hierarchyHintGroups: string[][];
  requiredKeywords: string[];
  searchQuery: string;
  searchQueryVariants: string[];
  resultExpectation?: {
    label: string;
    includeAny: string[];
    avoidAny: string[];
  };
  listingFilter?: {
    requireWomenWear?: boolean;
    requireHikingWear?: boolean;
    requireRedColor?: boolean;
    maxLumpSum?: number;
    preferInch?: number;
    excludeRental?: boolean;
  };
  listingModeLabel?: string;
  sortPriceAsc: boolean;
  summaryCount: number;
}

type PlannerMode = 'llm_first' | 'rule_first';
type PlannerTier = 'flash' | 'pro';

type PlannerAction =
  | {
      kind: 'navigate';
      url: string;
      reason?: string;
    }
  | {
      kind: 'hint_navigate';
      hints: string[];
      sortPriceAsc?: boolean;
      reason?: string;
    }
  | {
      kind: 'click';
      selectors?: string[];
      textHints?: string[];
      label?: string;
      reason?: string;
    }
  | {
      kind: 'type';
      selectors?: string[];
      textHints?: string[];
      value: string;
      submit?: boolean;
      label?: string;
      reason?: string;
    }
  | {
      kind: 'wait';
      ms: number;
      reason?: string;
    }
  | {
      kind: 'summarize';
      maxItems?: number;
      reason?: string;
    }
  | {
      kind: 'handoff';
      handoffType: ChatAutomationHandoffType;
      prompt: string;
      reason?: string;
    }
  | {
      kind: 'noop';
      reason?: string;
    };

interface PlannerPlan {
  source: 'llm' | 'rule_fallback';
  tier?: PlannerTier;
  provider?: SummaryLlmProvider;
  model?: string;
  actions: PlannerAction[];
  notes?: string;
}

interface PlannerActionExecutionSignal {
  hintNavigateSuccess: number;
  hintNavigateSkipped: number;
  searchActionSucceeded: number;
  searchActionSkipped: number;
  filterActionSucceeded: number;
  filterActionSkipped: number;
  budgetFilterSucceeded: number;
  colorFilterSucceeded: number;
}

interface TaskAnalysisStrategyOption {
  name: string;
  whenToUse?: string;
  steps: string[];
  risks: string[];
}

interface TaskAnalysis {
  source: 'llm' | 'rule';
  tier?: PlannerTier;
  provider?: SummaryLlmProvider;
  model?: string;
  taskType: string;
  siteType: string;
  goalSummary: string;
  constraintBuckets: {
    must: string[];
    prefer: string[];
    avoid: string[];
  };
  stagedApproach: string[];
  strategyOptions: TaskAnalysisStrategyOption[];
  recommendedStrategy?: string;
  strategyRationale?: string;
  confidence: number;
}

interface ResultValidation {
  valid: boolean;
  confidence: number;
  reason: string;
  missingConstraints: string[];
  retryHints: string[];
  source: 'llm' | 'rule';
  tier?: PlannerTier;
  provider?: SummaryLlmProvider;
  model?: string;
}

type SummaryLlmProvider = 'gemini' | 'openai';

interface SummaryLlmTarget {
  provider: SummaryLlmProvider;
  apiKey: string;
  model: string;
  baseUrl: string;
}

const LF_ATTR = {
  traceName: 'langfuse.trace.name',
  traceInput: 'langfuse.trace.input',
  traceOutput: 'langfuse.trace.output',
  traceMetadata: 'langfuse.trace.metadata',
  traceSessionId: 'session.id',
  traceUserId: 'user.id',
  observationType: 'langfuse.observation.type',
  observationInput: 'langfuse.observation.input',
  observationOutput: 'langfuse.observation.output',
  observationModel: 'langfuse.observation.model.name',
  observationModelCompat: 'langfuse.observation.model',
  observationModelParameters: 'langfuse.observation.model.parameters',
  observationUsageDetails: 'langfuse.observation.usage_details',
  observationUsageCompat: 'langfuse.observation.usage',
  observationMetadata: 'langfuse.observation.metadata',
  observationStatusMessage: 'langfuse.observation.status_message'
} as const;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function ensureNonEmpty(value: string, name: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error(`${name} must not be empty`);
  }
  return trimmed;
}

function parseOptionalNumber(raw: string | undefined): number | undefined {
  if (!raw) {
    return undefined;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  return parsed;
}

function parseCsv(raw: string | undefined): string[] {
  if (!raw) {
    return [];
  }
  return raw
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

function truncateForTelemetry(value: string, maxChars = 16_000): string {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, maxChars)}\n...(truncated)`;
}

function trimOptional(raw: string | undefined): string | undefined {
  if (!raw) {
    return undefined;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function firstNonEmpty(values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const trimmed = trimOptional(value);
    if (trimmed) {
      return trimmed;
    }
  }
  return undefined;
}

function isProviderCompatibleModel(provider: SummaryLlmProvider, model: string | undefined): boolean {
  const trimmed = trimOptional(model);
  if (!trimmed) {
    return false;
  }
  if (provider === 'gemini') {
    return /gemini|nano-banana|deep-research/i.test(trimmed);
  }
  return /^(gpt-|o[1-9]|chatgpt|codex)/i.test(trimmed);
}

function providerModelOrUndefined(provider: SummaryLlmProvider, model: string | undefined): string | undefined {
  return isProviderCompatibleModel(provider, model) ? trimOptional(model) : undefined;
}

function normalizeGeminiBaseUrl(rawBaseUrl: string): { baseUrl: string; warning?: string } {
  const defaultBaseUrl = 'https://generativelanguage.googleapis.com/v1beta';
  const trimmed = trimOptional(rawBaseUrl) ?? defaultBaseUrl;
  try {
    const parsed = new URL(trimmed);
    const host = parsed.hostname.toLowerCase();
    const normalizedPath = parsed.pathname.replace(/\/+$/, '');

    if (host.includes('langfuse')) {
      return {
        baseUrl: defaultBaseUrl,
        warning: `GEMINI_BASE_URL points to Langfuse host (${parsed.host}); fallback to default Gemini endpoint applied`
      };
    }

    if (host === 'generativelanguage.googleapis.com' && !/^\/v\d/i.test(normalizedPath)) {
      return {
        baseUrl: `${parsed.origin}/v1beta`,
        warning: 'GEMINI_BASE_URL had no API version path; normalized to /v1beta'
      };
    }

    return {
      baseUrl: `${parsed.origin}${normalizedPath || ''}`
    };
  } catch {
    return {
      baseUrl: trimmed
    };
  }
}

async function readResponseBodySafe(response: Response): Promise<string> {
  try {
    const raw = (await response.text()).trim();
    if (!raw) {
      return '';
    }
    return raw.replace(/\s+/g, ' ').slice(0, 280);
  } catch {
    return '';
  }
}

function resolveSummaryLlmTarget(provider: SummaryLlmProvider): SummaryLlmTarget | undefined {
  if (provider === 'gemini') {
    const apiKey = firstNonEmpty([process.env.GEMINI_API_KEY]);
    if (!apiKey) {
      return undefined;
    }
    const configuredModels = parseCsv(process.env.GEMINI_MODELS);
    const flashModel = selectTierModel('gemini', 'flash', configuredModels);
    const genericAutomationModel = providerModelOrUndefined('gemini', process.env.BACKEND_AUTOMATION_MODEL);
    const genericModel = providerModelOrUndefined('gemini', process.env.LLM_MODEL);
    const model =
      firstNonEmpty([
        process.env.BACKEND_AUTOMATION_GEMINI_MODEL,
        genericAutomationModel,
        flashModel,
        genericModel
      ]) ??
      'gemini-3-flash-preview';
    const baseUrl =
      firstNonEmpty([process.env.GEMINI_BASE_URL, process.env.LLM_BASE_URL]) ??
      'https://generativelanguage.googleapis.com/v1beta';
    return { provider, apiKey, model, baseUrl };
  }

  const apiKey = firstNonEmpty([process.env.OPENAI_API_KEY]);
  if (!apiKey) {
    return undefined;
  }
  const configuredModels = parseCsv(process.env.OPENAI_MODELS);
  const miniModel = selectTierModel('openai', 'flash', configuredModels);
  const genericAutomationModel = providerModelOrUndefined('openai', process.env.BACKEND_AUTOMATION_MODEL);
  const genericModel = providerModelOrUndefined('openai', process.env.LLM_MODEL);
  const model =
    firstNonEmpty([
      process.env.BACKEND_AUTOMATION_OPENAI_MODEL,
      genericAutomationModel,
      miniModel,
      genericModel
    ]) ??
    'gpt-5-mini';
  const baseUrl =
    firstNonEmpty([process.env.OPENAI_BASE_URL, process.env.LLM_BASE_URL]) ??
    'https://api.openai.com/v1';
  return { provider, apiKey, model, baseUrl };
}

function selectTierModel(
  provider: SummaryLlmProvider,
  tier: PlannerTier,
  configured: string[]
): string | undefined {
  if (configured.length === 0) {
    return undefined;
  }

  const normalized = configured.map((value) => value.trim()).filter((value) => value.length > 0);
  if (normalized.length === 0) {
    return undefined;
  }

  if (provider === 'gemini') {
    const matched =
      tier === 'pro'
        ? normalized.find((value) => /pro/i.test(value))
        : normalized.find((value) => /flash/i.test(value));
    return matched ?? normalized[0];
  }

  const matched =
    tier === 'pro'
      ? normalized.find((value) => /codex|gpt-5\.2/i.test(value))
      : normalized.find((value) => /mini|gpt-5/i.test(value));
  return matched ?? normalized[0];
}

function resolvePlannerLlmTarget(provider: SummaryLlmProvider, tier: PlannerTier): SummaryLlmTarget | undefined {
  if (provider === 'gemini') {
    const apiKey = firstNonEmpty([process.env.GEMINI_API_KEY]);
    if (!apiKey) {
      return undefined;
    }
    const configuredModels = parseCsv(process.env.GEMINI_MODELS);
    const modelByTier = selectTierModel('gemini', tier, configuredModels);
    const genericAutomationModel = providerModelOrUndefined('gemini', process.env.BACKEND_AUTOMATION_MODEL);
    const genericEscalationModel = providerModelOrUndefined('gemini', process.env.BACKEND_CASCADE_ESCALATION_MODEL);
    const model =
      tier === 'pro'
        ? firstNonEmpty([
            process.env.BACKEND_CASCADE_ESCALATION_GEMINI_MODEL,
            genericEscalationModel,
            modelByTier
          ]) ?? 'gemini-3.1-pro-preview'
        : firstNonEmpty([
            process.env.BACKEND_AUTOMATION_GEMINI_MODEL,
            genericAutomationModel,
            modelByTier
          ]) ?? 'gemini-3-flash-preview';
    const baseUrl =
      firstNonEmpty([process.env.GEMINI_BASE_URL, process.env.LLM_BASE_URL]) ??
      'https://generativelanguage.googleapis.com/v1beta';
    return {
      provider,
      apiKey,
      model,
      baseUrl
    };
  }

  const apiKey = firstNonEmpty([process.env.OPENAI_API_KEY]);
  if (!apiKey) {
    return undefined;
  }
  const configuredModels = parseCsv(process.env.OPENAI_MODELS);
  const modelByTier = selectTierModel('openai', tier, configuredModels);
  const genericAutomationModel = providerModelOrUndefined('openai', process.env.BACKEND_AUTOMATION_MODEL);
  const genericEscalationModel = providerModelOrUndefined('openai', process.env.BACKEND_CASCADE_ESCALATION_MODEL);
  const model =
    tier === 'pro'
      ? firstNonEmpty([
          process.env.BACKEND_CASCADE_ESCALATION_OPENAI_MODEL,
          genericEscalationModel,
          modelByTier
        ]) ?? 'gpt-5-codex'
      : firstNonEmpty([
          process.env.BACKEND_AUTOMATION_OPENAI_MODEL,
          genericAutomationModel,
          modelByTier
        ]) ?? 'gpt-5-mini';
  const baseUrl =
    firstNonEmpty([process.env.OPENAI_BASE_URL, process.env.LLM_BASE_URL]) ??
    'https://api.openai.com/v1';
  return {
    provider,
    apiKey,
    model,
    baseUrl
  };
}

function llmProviderOrder(): SummaryLlmProvider[] {
  const configured = parseCsv(process.env.LLM_VENDOR_ORDER).map((value) =>
    value.toLowerCase()
  );
  if (configured.length === 0) {
    return ['gemini', 'openai'];
  }
  const order: SummaryLlmProvider[] = [];
  for (const row of configured) {
    if ((row === 'gemini' || row === 'openai') && !order.includes(row)) {
      order.push(row);
    }
  }
  return order.length > 0 ? order : ['gemini', 'openai'];
}

function extractGeminiText(payload: unknown): string {
  if (!payload || typeof payload !== 'object') {
    return '';
  }

  const candidates = (payload as Record<string, unknown>).candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return '';
  }

  const first = candidates[0] as Record<string, unknown>;
  const content = first.content as Record<string, unknown> | undefined;
  const parts = content?.parts;
  if (!Array.isArray(parts)) {
    return '';
  }

  return parts
    .map((part) => {
      if (part && typeof part === 'object' && typeof (part as Record<string, unknown>).text === 'string') {
        return String((part as Record<string, unknown>).text);
      }
      return '';
    })
    .join('\n')
    .trim();
}

function extractOpenAiText(payload: unknown): string {
  if (!payload || typeof payload !== 'object') {
    return '';
  }
  const choices = (payload as Record<string, unknown>).choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    return '';
  }
  const message = (choices[0] as Record<string, unknown>).message as Record<string, unknown> | undefined;
  if (typeof message?.content === 'string') {
    return message.content.trim();
  }
  if (Array.isArray(message?.content)) {
    return message.content
      .map((part) => {
        if (
          part &&
          typeof part === 'object' &&
          typeof (part as Record<string, unknown>).text === 'string'
        ) {
          return String((part as Record<string, unknown>).text);
        }
        return '';
      })
      .join('\n')
      .trim();
  }
  return '';
}

function extractGeminiUsageDetails(payload: unknown): Record<string, number> | undefined {
  if (!payload || typeof payload !== 'object') {
    return undefined;
  }
  const usage = (payload as Record<string, unknown>).usageMetadata;
  if (!usage || typeof usage !== 'object') {
    return undefined;
  }
  const usageRecord = usage as Record<string, unknown>;
  const toNumber = (value: unknown): number | undefined => {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    return undefined;
  };
  const input = toNumber(usageRecord.promptTokenCount) ?? toNumber(usageRecord.inputTokenCount);
  const output =
    toNumber(usageRecord.candidatesTokenCount) ??
    toNumber(usageRecord.outputTokenCount) ??
    toNumber(usageRecord.responseTokenCount);
  const total = toNumber(usageRecord.totalTokenCount);
  const cachedInput = toNumber(usageRecord.cachedContentTokenCount);
  const details: Record<string, number> = {};
  if (typeof input === 'number') {
    details.input_tokens = input;
  }
  if (typeof output === 'number') {
    details.output_tokens = output;
  }
  if (typeof total === 'number') {
    details.total_tokens = total;
  }
  if (typeof cachedInput === 'number') {
    details.cached_input_tokens = cachedInput;
  }
  return Object.keys(details).length > 0 ? details : undefined;
}

function extractOpenAiUsageDetails(payload: unknown): Record<string, number> | undefined {
  if (!payload || typeof payload !== 'object') {
    return undefined;
  }
  const usage = (payload as Record<string, unknown>).usage;
  if (!usage || typeof usage !== 'object') {
    return undefined;
  }
  const usageRecord = usage as Record<string, unknown>;
  const details: Record<string, number> = {};
  const push = (key: string, value: unknown): void => {
    if (typeof value === 'number' && Number.isFinite(value)) {
      details[key] = value;
    }
  };
  push('input_tokens', usageRecord.prompt_tokens);
  push('output_tokens', usageRecord.completion_tokens);
  push('total_tokens', usageRecord.total_tokens);
  push('reasoning_tokens', usageRecord.reasoning_tokens);
  return Object.keys(details).length > 0 ? details : undefined;
}

function normalizeMessage(raw: string): string {
  return raw.toLowerCase();
}

function parseSummaryCount(message: string): number {
  const normalized = normalizeMessage(message);
  if (/(하나만|하나|한개만|한 개만|한개|한 개|single|just one|only one)/i.test(normalized)) {
    return 1;
  }
  const countUnitMatch = normalized.match(/(\d+)\s*(개|건|종류|가지|items?|news|results?)/i);
  if (countUnitMatch?.[1]) {
    const parsed = Number(countUnitMatch[1]);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.min(10, Math.max(1, Math.floor(parsed)));
    }
  }
  const topMatch = normalized.match(/top\s*(\d+)/i);
  if (topMatch?.[1]) {
    const parsed = Number(topMatch[1]);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.min(10, Math.max(1, Math.floor(parsed)));
    }
  }
  if (/(몇개|몇 개|some|few)/i.test(normalized)) {
    return 5;
  }
  return 5;
}

function parseBudgetUpperBoundKrw(message: string): number | undefined {
  const normalized = normalizeMessage(message);
  const manwon = normalized.match(/(\d+(?:\.\d+)?)\s*만원(?:\s*(?:이하|미만|under|less))?/i);
  if (manwon?.[1]) {
    const parsed = Number(manwon[1]);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.floor(parsed * 10_000);
    }
  }

  const won = normalized.match(/(\d[\d,]*)\s*원(?:\s*(?:이하|미만|under|less))?/i);
  if (won?.[1]) {
    const parsed = Number(won[1].replace(/,/g, ''));
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.floor(parsed);
    }
  }

  const underKrw = normalized.match(/under\s*([\d,]+)\s*(?:krw|won)/i);
  if (underKrw?.[1]) {
    const parsed = Number(underKrw[1].replace(/,/g, ''));
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.floor(parsed);
    }
  }

  return undefined;
}

function parsePreferredInch(message: string): number | undefined {
  const normalized = normalizeMessage(message);
  const matched = normalized.match(/(\d{2,3})\s*(?:인치|inch|")/i);
  if (!matched?.[1]) {
    return undefined;
  }
  const parsed = Number(matched[1]);
  if (!Number.isFinite(parsed) || parsed < 10 || parsed > 120) {
    return undefined;
  }
  return Math.floor(parsed);
}

function extractListingPathHints(message: string): string[] {
  const stopWords = new Set([
    'http',
    'https',
    'www',
    'com',
    'net',
    'org',
    'co',
    'kr',
    'site',
    'website',
    'visit',
    'open',
    'go',
    '가기',
    '가서',
    '방문',
    '열기',
    '열어',
    '열어서',
    '페이지',
    'summary',
    'summarize',
    '요약',
    '정리',
    '간추려',
    '보여줘',
    '알려줘',
    '리스팅',
    '리스트',
    'listing',
    'list',
    '찾아줘',
    '찾기',
    '중에서',
    '에서',
    '그리고',
    'with',
    'from',
    'only',
    'just',
    'top'
  ]);
  const seen = new Set<string>();
  const hints: string[] = [];
  const pushHint = (raw: string): void => {
    const cleaned = raw
      .replace(/https?:\/\/[^\s)]+/gi, ' ')
      .replace(/\b(?:www\.)?[a-z0-9-]+\.(?:com|net|org|co|kr|io|tv|me|shop)\b/gi, ' ')
      .replace(/\b(?:http|https|www|com|net|org|co|kr|io)\b/gi, ' ')
      .replace(/(?:에\s*가서|가서|방문(?:해서)?|들어가서|접속해서|열어(?:서)?|이동해서|open|visit|website|site)/gi, ' ')
      .replace(/[()[\]{}"'`]/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/(중에서|에서|으로|로)$/g, '')
      .trim();
    if (cleaned.length < 2 || cleaned.length > 32) {
      return;
    }
    const key = cleaned.toLowerCase();
    if (stopWords.has(key)) {
      return;
    }
    if (/(^|\s)(com|net|org|co|kr|io|www|http|https)(\s|$)/i.test(` ${key} `)) {
      return;
    }
    if (/(에\s*가서|가서|방문|열어|open|visit|website|site)/i.test(key)) {
      return;
    }
    if (/^\d+$/.test(key)) {
      return;
    }
    if (/\.(?:com|net|org|co|kr|io)$/.test(key)) {
      return;
    }
    if (
      !/(의류|복|카테고리|메뉴|스포츠|여성|남성|아웃도어|등산|러닝|운동|패션|가전|생활|식품|키즈|신발|가방|검색|상품|전체|레드|빨강|red|hiking|outdoor|sports|women|men|apparel|fashion|category|menu)/i.test(
        cleaned
      )
    ) {
      return;
    }
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    hints.push(cleaned);
  };

  for (const matched of message.matchAll(/([A-Za-z0-9가-힣][A-Za-z0-9가-힣\s/_-]{1,30})\s*(?:메뉴|카테고리|category)/gi)) {
    pushHint(matched[1] ?? '');
  }

  const withoutUrl = message.replace(/https?:\/\/[^\s)]+/gi, ' ');
  const tokens = withoutUrl.match(/[A-Za-z0-9가-힣][A-Za-z0-9가-힣._/-]{1,30}/g) ?? [];
  for (const token of tokens) {
    pushHint(token);
  }

  return hints.slice(0, 8);
}

function extractRequiredKeywords(message: string): string[] {
  const stopWords = new Set([
    '가서',
    '방문',
    '메뉴',
    '카테고리',
    'category',
    '중에서',
    '에서',
    '찾아줘',
    '찾기',
    '하나',
    '하나만',
    '요약',
    '정리',
    '리스팅',
    '리스트',
    'listing',
    'list',
    '가격',
    '최저',
    '저렴',
    '이하',
    '미만',
    'open',
    'visit',
    'site',
    'the',
    'and',
    'with'
  ]);
  const productSuffixPattern =
    /(복|의류|티|셔츠|자켓|점퍼|바지|치마|신발|화|가방|모자|양말|장갑|코트|dress|jacket|pants|shirt|shoes|socks)$/i;
  const rawTokens = message.match(/[A-Za-z가-힣][A-Za-z가-힣0-9]{1,20}/g) ?? [];
  const seen = new Set<string>();
  const picked: string[] = [];
  for (const token of rawTokens) {
    const cleaned = token
      .trim()
      .replace(/(중에서|에서|으로|로|만|를|을)$/g, '');
    if (cleaned.length < 2) {
      continue;
    }
    const lower = cleaned.toLowerCase();
    if (stopWords.has(lower)) {
      continue;
    }
    if (/^(www|http|https|com|net|org|co|kr)$/.test(lower)) {
      continue;
    }
    if (/^\d+$/.test(lower)) {
      continue;
    }
    if (!productSuffixPattern.test(cleaned) && !/(등산복|아웃도어|hiking|outdoor|sportswear|짐웨어)/i.test(cleaned)) {
      continue;
    }
    if (seen.has(lower)) {
      continue;
    }
    seen.add(lower);
    picked.push(cleaned);
    if (picked.length >= 6) {
      break;
    }
  }
  return picked;
}

function buildSearchQueryFromIntent(message: string, requiredKeywords: string[], intentFilter?: TaskIntent['listingFilter']): string {
  const queryTokens: string[] = [];
  for (const keyword of requiredKeywords) {
    if (!queryTokens.includes(keyword)) {
      queryTokens.push(keyword);
    }
  }
  if (intentFilter?.requireWomenWear && !queryTokens.some((token) => /(여성|women|woman)/i.test(token))) {
    queryTokens.push('여성');
  }
  if (intentFilter?.requireHikingWear && !queryTokens.some((token) => /(등산|hiking|outdoor)/i.test(token))) {
    queryTokens.push('등산');
  }
  if (intentFilter?.requireRedColor && !queryTokens.some((token) => /(레드|빨강|red)/i.test(token))) {
    queryTokens.push('레드');
  }
  if (
    typeof intentFilter?.maxLumpSum === 'number' &&
    Number.isFinite(intentFilter.maxLumpSum) &&
    intentFilter.maxLumpSum > 0
  ) {
    const rounded = Math.floor(intentFilter.maxLumpSum / 10_000);
    queryTokens.push(`${rounded}만원 이하`);
  }
  if (queryTokens.length === 0) {
    const fallback = message
      .replace(/https?:\/\/[^\s)]+/gi, ' ')
      .replace(/[^A-Za-z0-9가-힣\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return fallback.slice(0, 64);
  }
  return queryTokens.slice(0, 6).join(' ');
}

function buildSearchQueryVariants(
  searchQuery: string,
  requiredKeywords: string[],
  listingPathHints: string[],
  intentFilter?: TaskIntent['listingFilter']
): string[] {
  const variants: string[] = [];
  const pushVariant = (raw: string): void => {
    const value = raw.trim().replace(/\s+/g, ' ');
    if (!value) {
      return;
    }
    if (!variants.some((entry) => entry.toLowerCase() === value.toLowerCase())) {
      variants.push(value);
    }
  };

  pushVariant(searchQuery);
  if (requiredKeywords.length > 0) {
    pushVariant(requiredKeywords.slice(0, 4).join(' '));
  }
  if (listingPathHints.length > 0) {
    pushVariant(listingPathHints.slice(0, 4).join(' '));
  }

  const taxonomyTokens: string[] = [];
  if (intentFilter?.requireWomenWear) {
    taxonomyTokens.push('여성');
  }
  if (intentFilter?.requireHikingWear) {
    taxonomyTokens.push('등산복');
  }
  if (intentFilter?.requireRedColor) {
    taxonomyTokens.push('레드');
  }
  if (
    typeof intentFilter?.maxLumpSum === 'number' &&
    Number.isFinite(intentFilter.maxLumpSum) &&
    intentFilter.maxLumpSum > 0
  ) {
    taxonomyTokens.push(`${Math.floor(intentFilter.maxLumpSum / 10_000)}만원 이하`);
  }
  if (taxonomyTokens.length > 0) {
    pushVariant(taxonomyTokens.join(' '));
  }
  if (requiredKeywords.length > 0 && taxonomyTokens.length > 0) {
    pushVariant([...requiredKeywords.slice(0, 3), ...taxonomyTokens.slice(0, 3)].join(' '));
  }
  if (variants.length === 0) {
    pushVariant(searchQuery);
  }
  return variants.slice(0, 6);
}

function buildBudgetTextHints(maxLumpSum: number): string[] {
  if (!Number.isFinite(maxLumpSum) || maxLumpSum <= 0) {
    return [];
  }
  const normalized = Math.floor(maxLumpSum);
  const manwon = Math.max(1, Math.floor(normalized / 10_000));
  const base = uniqueStringList(
    [
      `${manwon}만원 이하`,
      `${manwon} 만원 이하`,
      `${manwon}만원`,
      `${manwon}만원대`,
      `${normalized.toLocaleString()}원 이하`,
      `${normalized}원 이하`,
      '가격',
      '최저가',
      '가격대',
      '가격필터'
    ],
    10
  );
  return base;
}

function hasPlannerSignalToken(actions: PlannerAction[], tokenPattern: RegExp): boolean {
  return actions.some((action) => {
    if (action.kind === 'hint_navigate') {
      return action.hints.some((hint) => tokenPattern.test(hint));
    }
    if (action.kind === 'click' || action.kind === 'type') {
      const hints = action.textHints ?? [];
      const label = action.label ?? '';
      return hints.some((hint) => tokenPattern.test(hint)) || tokenPattern.test(label);
    }
    return false;
  });
}

function plannerActionSignalText(action: PlannerAction): string {
  if (action.kind === 'hint_navigate') {
    return action.hints.join(' ');
  }
  if (action.kind === 'click') {
    return `${action.label ?? ''} ${(action.textHints ?? []).join(' ')} ${(action.selectors ?? []).join(' ')}`.trim();
  }
  if (action.kind === 'type') {
    return `${action.label ?? ''} ${(action.textHints ?? []).join(' ')} ${(action.selectors ?? []).join(' ')} ${action.value}`.trim();
  }
  return action.reason ?? '';
}

function isSearchPlannerAction(action: PlannerAction): boolean {
  if (action.kind !== 'click' && action.kind !== 'type') {
    return false;
  }
  const signal = plannerActionSignalText(action);
  return /(검색|search|query|fallback-search|search-query|akcsearch|검색어)/i.test(signal);
}

function isRootHintNavigateAction(
  action: PlannerAction
): action is Extract<PlannerAction, { kind: 'hint_navigate' }> {
  if (action.kind !== 'hint_navigate' || action.hints.length === 0) {
    return false;
  }
  return action.hints.every((hint) => isGenericNavigationHint(hint));
}

function isFilterPlannerAction(action: PlannerAction): boolean {
  if (action.kind !== 'click' && action.kind !== 'type' && action.kind !== 'hint_navigate') {
    return false;
  }
  if (action.kind !== 'hint_navigate' && isSearchPlannerAction(action)) {
    return false;
  }
  const signal = plannerActionSignalText(action);
  return /(필터|filter|조건|가격|price|예산|budget|만원|원 이하|색상|color|컬러|red|레드|빨강|붉)/i.test(
    signal
  );
}

function isBudgetFilterPlannerAction(action: PlannerAction): boolean {
  if (action.kind !== 'click' && action.kind !== 'type') {
    return false;
  }
  if (isSearchPlannerAction(action)) {
    return false;
  }
  const signal = plannerActionSignalText(action);
  return /(listing-budget-filter|budget|예산|가격|price|만원|원 이하|max|최대|상한|금액)/i.test(signal);
}

function isColorFilterPlannerAction(action: PlannerAction): boolean {
  if (action.kind !== 'click' && action.kind !== 'type') {
    return false;
  }
  if (isSearchPlannerAction(action)) {
    return false;
  }
  const signal = plannerActionSignalText(action);
  return /(listing-color-filter|색상|color|컬러|red|레드|빨강|붉)/i.test(signal);
}

function missingRequiredListingFilters(
  intent: TaskIntent,
  signal: Pick<PlannerActionExecutionSignal, 'budgetFilterSucceeded' | 'colorFilterSucceeded'>
): string[] {
  const missing: string[] = [];
  const requiresBudget =
    typeof intent.listingFilter?.maxLumpSum === 'number' &&
    Number.isFinite(intent.listingFilter.maxLumpSum) &&
    intent.listingFilter.maxLumpSum > 0;
  if (requiresBudget && signal.budgetFilterSucceeded <= 0) {
    missing.push('budget');
  }
  if (intent.listingFilter?.requireRedColor && signal.colorFilterSucceeded <= 0) {
    missing.push('color');
  }
  return missing;
}

function shouldForceMenuFirstForAttempt(intent: TaskIntent): boolean {
  const strictCategoryRequest =
    intent.hierarchyHintGroups.length >= 3 &&
    Boolean(intent.listingFilter?.requireWomenWear || intent.listingFilter?.requireHikingWear);
  const strictFilterRequest = Boolean(
    intent.listingFilter?.requireRedColor ||
      (typeof intent.listingFilter?.maxLumpSum === 'number' &&
        Number.isFinite(intent.listingFilter.maxLumpSum) &&
        intent.listingFilter.maxLumpSum > 0)
  );
  return intent.wantsListingNavigation && strictCategoryRequest && strictFilterRequest;
}

function appendConstraintProbeActions(actions: PlannerAction[], intent: TaskIntent, reason: string): void {
  if (!intent.listingFilter) {
    return;
  }

  const hasFilterOpen = hasPlannerSignalToken(
    actions,
    /(listing-filter-open|filter[-_\s]?open|open\s*filter|필터\s*(열기|보기)|상세\s*검색|상세검색|검색\s*옵션|조건\s*(열기|보기)|refine|facet|sidebar|panel)/i
  );
  if (!hasFilterOpen) {
    actions.push({
      kind: 'click',
      textHints: ['필터', '조건', '가격', '색상', '정렬', 'filter', 'sort', 'price'],
      label: 'listing-filter-open',
      reason
    });
    actions.push({
      kind: 'wait',
      ms: 850,
      reason
    });
  }

  if (
    typeof intent.listingFilter.maxLumpSum === 'number' &&
    Number.isFinite(intent.listingFilter.maxLumpSum) &&
    intent.listingFilter.maxLumpSum > 0 &&
    !hasPlannerSignalToken(actions, /(만원|원 이하|budget|가격대)/i)
  ) {
    const hints = buildBudgetTextHints(intent.listingFilter.maxLumpSum);
    if (hints.length > 0) {
      actions.push({
        kind: 'click',
        textHints: hints,
        label: 'listing-budget-filter',
        reason
      });
      actions.push({
        kind: 'wait',
        ms: 750,
        reason
      });
    }
  }

  if (
    intent.listingFilter.requireWomenWear &&
    !hasPlannerSignalToken(actions, /(여성|여성의류|여성스포츠의류|women|woman|lady)/i)
  ) {
    actions.push({
      kind: 'hint_navigate',
      hints: ['여성', '여성의류', '여성스포츠의류', 'women'],
      sortPriceAsc: false,
      reason
    });
  }

  if (
    intent.listingFilter.requireHikingWear &&
    !hasPlannerSignalToken(actions, /(등산복|등산|아웃도어|하이킹|hiking|outdoor)/i)
  ) {
    actions.push({
      kind: 'hint_navigate',
      hints: ['등산복', '등산', '아웃도어', 'hiking', 'outdoor'],
      sortPriceAsc: false,
      reason
    });
  }

  if (
    intent.listingFilter.requireRedColor &&
    !hasPlannerSignalToken(actions, /(레드|빨강|붉은|red)/i)
  ) {
    actions.push({
      kind: 'click',
      textHints: ['색상', '컬러', 'color', '레드', '빨강', '붉은', 'red'],
      label: 'listing-color-filter-red',
      reason
    });
    actions.push({
      kind: 'wait',
      ms: 700,
      reason
    });
  }
}

function uniqueStringList(values: string[], maxItems: number): string[] {
  const seen = new Set<string>();
  const rows: string[] = [];
  for (const value of values) {
    const cleaned = value.trim();
    if (!cleaned) {
      continue;
    }
    const key = cleaned.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    rows.push(cleaned);
    if (rows.length >= maxItems) {
      break;
    }
  }
  return rows;
}

function isGenericNavigationHint(raw: string): boolean {
  const value = raw.trim().toLowerCase();
  if (!value) {
    return false;
  }
  return /^(카테고리|전체카테고리|전체\s*카테고리|메뉴|전체메뉴|전체\s*메뉴|category|categories|menu|navigation|nav|browse)$/.test(
    value
  );
}

function isBroadNavigationHint(raw: string): boolean {
  const value = raw.trim().toLowerCase();
  if (!value) {
    return false;
  }
  if (isGenericNavigationHint(value)) {
    return true;
  }
  if (value.length <= 2) {
    return true;
  }
  return /^(의류|스포츠|스포츠의류|패션|상품|쇼핑|여성|남성|women|woman|men|sports|sportswear|apparel|fashion|shop|shopping|list|listing)$/i.test(
    value
  );
}

function shouldSkipHintNavigateAfterContextOpen(
  action: Extract<PlannerAction, { kind: 'hint_navigate' }>,
  intent: TaskIntent
): boolean {
  const hints = uniqueStringList(action.hints.map((hint) => hint.trim()), 8).filter((hint) => hint.length > 0);
  if (hints.length === 0) {
    return true;
  }

  const specificSignals = new Set<string>();
  for (const keyword of intent.requiredKeywords.slice(0, 6)) {
    if (keyword.trim().length >= 2) {
      specificSignals.add(keyword.toLowerCase());
    }
  }
  for (const row of intent.listingPathHints.slice(0, 6)) {
    if (row.trim().length >= 2) {
      specificSignals.add(row.toLowerCase());
    }
  }
  if (intent.listingFilter?.requireHikingWear) {
    ['등산', '등산복', '아웃도어', 'hiking', 'outdoor'].forEach((signal) => specificSignals.add(signal));
  }
  if (intent.listingFilter?.requireRedColor) {
    ['레드', '빨강', '붉', 'red'].forEach((signal) => specificSignals.add(signal));
  }
  if (intent.listingFilter?.requireWomenWear) {
    ['여성스포츠의류', '여성의류'].forEach((signal) => specificSignals.add(signal));
  }

  const hasSpecific = hints.some((hint) => {
    const lowered = hint.toLowerCase();
    return Array.from(specificSignals).some(
      (signal) => lowered.includes(signal) || signal.includes(lowered)
    );
  });
  if (hasSpecific) {
    return false;
  }

  return hints.every((hint) => isBroadNavigationHint(hint));
}

function collectNormalizedHintTokens(hints: string[]): string[] {
  return uniqueStringList(
    hints.map((hint) => hint.trim().toLowerCase()),
    16
  ).filter((hint) => hint.length > 0);
}

function calculateHintReuseRatio(hints: string[], seenHints: Set<string>): number {
  if (hints.length === 0) {
    return 0;
  }
  let reused = 0;
  for (const hint of hints) {
    if (seenHints.has(hint)) {
      reused += 1;
    }
  }
  return reused / hints.length;
}

function isBroadTraversalHint(raw: string): boolean {
  const value = raw.trim().toLowerCase();
  if (!value) {
    return false;
  }
  if (isGenericNavigationHint(value)) {
    return false;
  }
  return /^(의류|여성의류|남성의류|스포츠|스포츠의류|패션|상품|shopping|shop|sports|sport|sportswear|apparel|fashion|clothing|women|woman|men|man|여성|남성)$/i.test(
    value
  );
}

function expandPathLikeHints(raw: string): string[] {
  const cleaned = raw.trim();
  if (!cleaned) {
    return [];
  }
  const parts = cleaned
    .split(/[\/>|→›»]+/g)
    .map((part) => part.trim())
    .filter((part) => part.length >= 2);
  return uniqueStringList([cleaned, ...parts], 6);
}

function optimizeHintNavigateHints(rawHints: string[], intent: TaskIntent): string[] {
  const expandedHints = rawHints.flatMap((hint) => expandPathLikeHints(hint));
  const hints = uniqueStringList(expandedHints, 14).filter((hint) => hint.length > 0);
  const traversalAvoidTokens = new Set<string>();
  if (intent.listingFilter?.requireWomenWear || intent.listingFilter?.requireHikingWear) {
    [
      '자동차',
      '차량',
      'car',
      'auto',
      '가전',
      '디지털',
      '컴퓨터',
      '노트북',
      'tv',
      '식품',
      '주방',
      '문구',
      '도서'
    ].forEach((token) => traversalAvoidTokens.add(token));
  }
  const filteredHints = hints.filter((hint) => {
    const lowered = hint.toLowerCase();
    return !Array.from(traversalAvoidTokens).some(
      (token) => lowered.includes(token) || token.includes(lowered)
    );
  });
  let effectiveHints = filteredHints.length > 0 ? filteredHints : hints;
  const strictApparelTraversal =
    Boolean(intent.listingFilter?.requireWomenWear || intent.listingFilter?.requireHikingWear) &&
    intent.wantsListingNavigation;
  if (strictApparelTraversal) {
    const rootOnlyInput = effectiveHints.length > 0 && effectiveHints.every((hint) => isGenericNavigationHint(hint));
    if (rootOnlyInput) {
      return uniqueStringList(effectiveHints, 3);
    }
    const strictRelevantHints = effectiveHints.filter((hint) =>
      /(^카테고리$|^전체카테고리$|^메뉴$|category|menu|전체|스포츠|sport|여성|women|의류|apparel|clothing|등산복|등산|아웃도어|hiking|outdoor|트레킹|trekking)/i.test(
        hint
      )
    );
    const rootHints = strictRelevantHints.filter((hint) => isGenericNavigationHint(hint)).slice(0, 1);
    const nonRootHints = strictRelevantHints.filter((hint) => !isGenericNavigationHint(hint));
    const specificCategoryHints = nonRootHints.filter((hint) =>
      /(여성스포츠의류|등산복|아웃도어|등산|hiking|outdoor|trekking|트레킹)/i.test(hint)
    );
    const bridgeHints = nonRootHints.filter((hint) =>
      !specificCategoryHints.includes(hint) && /(스포츠|sport|골프|golf)/i.test(hint)
    );
    const narrowed = uniqueStringList([...rootHints, ...specificCategoryHints, ...bridgeHints.slice(0, 1)], 6);
    if (narrowed.length >= 2) {
      effectiveHints = narrowed;
    } else if (strictRelevantHints.length >= 2) {
      effectiveHints = uniqueStringList(strictRelevantHints, 6);
    }
  }
  if (effectiveHints.length <= 1) {
    return effectiveHints;
  }
  if (effectiveHints.every((hint) => isGenericNavigationHint(hint))) {
    return effectiveHints;
  }
  if (effectiveHints.some((hint) => isGenericNavigationHint(hint))) {
    const rootHints = effectiveHints.filter((hint) => isGenericNavigationHint(hint));
    const nonRootHints = effectiveHints.filter((hint) => !isGenericNavigationHint(hint));
    const highLevel = nonRootHints.filter((hint) => /(여성|women|woman|lady|의류|apparel|clothing|sports|sport|스포츠)/i.test(hint));
    const categoryLevel = nonRootHints.filter(
      (hint) =>
        !highLevel.includes(hint) &&
        /(등산복|hiking wear|outdoor wear|trekking wear|카테고리|category)/i.test(hint)
    );
    const deepLevel = nonRootHints.filter(
      (hint) => !highLevel.includes(hint) && !categoryLevel.includes(hint)
    );
    return uniqueStringList(
      [...rootHints.slice(0, 1), ...highLevel, ...categoryLevel, ...deepLevel],
      6
    );
  }

  const specific = effectiveHints.filter((hint) => !isBroadTraversalHint(hint));
  if (specific.length === 0) {
    return effectiveHints.slice(0, 8);
  }

  const specificLower = specific.map((hint) => hint.toLowerCase());
  const broadResidual = effectiveHints.filter((hint) => {
    if (!isBroadTraversalHint(hint)) {
      return false;
    }
    const lowered = hint.toLowerCase();
    return !specificLower.some((entry) => entry.includes(lowered));
  });

  if (
    !strictApparelTraversal &&
    !effectiveHints.some((hint) => isGenericNavigationHint(hint)) &&
    intent.listingFilter?.requireWomenWear &&
    !specificLower.some((entry) => /(여성|women|woman|lady)/i.test(entry))
  ) {
    broadResidual.unshift('여성');
  }
  if (
    !strictApparelTraversal &&
    !effectiveHints.some((hint) => isGenericNavigationHint(hint)) &&
    intent.listingFilter?.requireHikingWear &&
    !specificLower.some((entry) => /(등산|아웃도어|hiking|outdoor|trekking|트레킹)/i.test(entry))
  ) {
    broadResidual.unshift('등산');
  }

  const merged = [...specific, ...uniqueStringList(broadResidual, 2)];
  return uniqueStringList(merged, 8);
}

function isNavigationRootOnlyGroup(group: string[]): boolean {
  if (group.length === 0) {
    return false;
  }
  return group.every((entry) => isGenericNavigationHint(entry));
}

function shouldAllowNavigationRootHints(intent: TaskIntent): boolean {
  if (intent.explicitCategoryNavigation) {
    return true;
  }
  if (!intent.wantsListingNavigation) {
    return false;
  }
  return Boolean(
    (intent.listingPathHints.length >= 2 &&
      (intent.listingFilter?.requireWomenWear || intent.listingFilter?.requireHikingWear)) ||
      (intent.hierarchyHintGroups.length >= 3 &&
        (intent.listingFilter?.requireRedColor ||
          (typeof intent.listingFilter?.maxLumpSum === 'number' &&
            Number.isFinite(intent.listingFilter.maxLumpSum) &&
            intent.listingFilter.maxLumpSum > 0)))
  );
}

function buildHierarchyHintGroups(
  message: string,
  filter: TaskIntent['listingFilter'],
  requiredKeywords: string[],
  listingPathHints: string[],
  explicitCategoryNavigation: boolean
): string[][] {
  const normalized = normalizeMessage(message);
  const groups: string[][] = [];

  const shouldSeedNavigationRoot =
    explicitCategoryNavigation ||
    (listingPathHints.length >= 2 && Boolean(filter?.requireWomenWear || filter?.requireHikingWear));
  if (shouldSeedNavigationRoot) {
    const navigationRoot: string[] = ['카테고리', '전체카테고리', '메뉴'];
    groups.push(navigationRoot);
  }

  const highLevel: string[] = [];
  for (const hint of listingPathHints) {
    if (/(스포츠|sport|fashion|패션|의류|apparel|women|여성)/i.test(hint)) {
      highLevel.push(hint);
    }
  }
  if (/(의류|복|apparel|wear|clothing)/i.test(normalized)) {
    highLevel.push('의류');
  }
  if (/(스포츠|sports|sport)/i.test(normalized)) {
    highLevel.push('스포츠');
    highLevel.push('스포츠의류');
  }
  if (filter?.requireWomenWear) {
    highLevel.push('여성의류');
    highLevel.push('여성스포츠의류');
  }
  if (highLevel.length > 0) {
    groups.push(uniqueStringList(highLevel, 5));
  }

  const midLevel: string[] = [];
  for (const hint of listingPathHints) {
    if (/(아웃도어|등산|hiking|outdoor|trekking|트레킹)/i.test(hint)) {
      midLevel.push(hint);
    }
  }
  if (filter?.requireHikingWear || /(등산|아웃도어|hiking|outdoor|trekking|트레킹)/i.test(normalized)) {
    midLevel.push('아웃도어');
    midLevel.push('등산');
    midLevel.push('등산복');
  }
  if (midLevel.length > 0) {
    groups.push(uniqueStringList(midLevel, 5));
  }

  const detailLevel: string[] = [];
  for (const hint of listingPathHints) {
    if (/(레드|빨강|붉|red|등산복|자켓|점퍼|조끼|아우터|바람막이)/i.test(hint)) {
      detailLevel.push(hint);
    }
  }
  if (filter?.requireRedColor || /(레드|빨강|red)/i.test(normalized)) {
    detailLevel.push('레드');
    detailLevel.push('빨강');
  }
  for (const keyword of requiredKeywords) {
    if (/(등산복|아웃도어|자켓|점퍼|바지|티|셔츠|의류|복)/i.test(keyword)) {
      detailLevel.push(keyword);
    }
  }
  if (detailLevel.length > 0) {
    groups.push(uniqueStringList(detailLevel, 6));
  }

  if (groups.length === 0) {
    const fallback = uniqueStringList(listingPathHints, 6);
    if (fallback.length > 0) {
      groups.push(fallback);
    }
  }

  return groups.slice(0, 4);
}

function buildResultExpectation(
  message: string,
  filter: TaskIntent['listingFilter'],
  requiredKeywords: string[]
): TaskIntent['resultExpectation'] | undefined {
  const normalized = normalizeMessage(message);
  const wantsApparel =
    filter?.requireHikingWear === true ||
    /(등산복|의류|자켓|점퍼|티셔츠|셔츠|바지|상의|하의|아우터|apparel|clothing|wear)/i.test(normalized);

  if (!wantsApparel) {
    return undefined;
  }

  const includeAny = uniqueStringList(
    [
      '등산복',
      '등산',
      '아웃도어',
      '의류',
      'apparel',
      'wear',
      'clothing',
      '자켓',
      '점퍼',
      '조끼',
      '바람막이',
      '아우터',
      '패딩',
      '티셔츠',
      '셔츠',
      '바지',
      '상의',
      '하의',
      ...requiredKeywords.filter((row) => /(등산복|아웃도어|의류|자켓|점퍼|티|셔츠|바지|상의|하의)/i.test(row))
    ],
    12
  );
  const avoidAny = uniqueStringList(
    [
      '양말',
      '모자',
      '장갑',
      '가방',
      '등산스틱',
      '스틱',
      '폴',
      '등산장비',
      '장비',
      '텐트',
      '캠핑',
      '침낭',
      '랜턴',
      '버너',
      '벨트',
      '수건',
      '양말전용',
      '등산양말',
      '등산화',
      '운동화',
      '스포츠화',
      '신발',
      '슈즈',
      'socks',
      'cap',
      'gloves',
      'bag',
      'shoes',
      'shoe',
      'footwear',
      'sneaker'
    ],
    12
  );
  return {
    label: 'apparel_expected',
    includeAny,
    avoidAny
  };
}

function expandKeywordSignals(keyword: string): string[] {
  const raw = keyword.trim().toLowerCase();
  if (!raw) {
    return [];
  }

  const signals = new Set<string>();
  signals.add(raw);

  const tokenized = raw
    .replace(/[_/|,-]+/g, ' ')
    .split(/\s+/)
    .map((row) => row.trim())
    .filter((row) => row.length >= 2);
  for (const token of tokenized) {
    signals.add(token);
  }

  if (/(여성|women|woman|lady|우먼|여자)/i.test(raw)) {
    signals.add('여성');
    signals.add('women');
    signals.add('woman');
    signals.add('lady');
  }
  if (/(등산|하이킹|hiking|아웃도어|outdoor|mountain|트레킹)/i.test(raw)) {
    signals.add('등산');
    signals.add('하이킹');
    signals.add('hiking');
    signals.add('아웃도어');
    signals.add('outdoor');
    signals.add('mountain');
  }
  if (/(의류|복|apparel|wear|clothing|스포츠의류|sportswear)/i.test(raw)) {
    signals.add('의류');
    signals.add('복');
    signals.add('apparel');
    signals.add('wear');
    signals.add('clothing');
    signals.add('자켓');
    signals.add('점퍼');
    signals.add('조끼');
    signals.add('바람막이');
    signals.add('아우터');
    signals.add('티셔츠');
    signals.add('셔츠');
    signals.add('바지');
  }

  return Array.from(signals).slice(0, 18);
}

function parseTaskIntent(message: string): TaskIntent {
  const normalized = normalizeMessage(message);
  const wantsWomenWear = /(여성|여자|여성용|women|woman|lady|우먼)/i.test(normalized);
  const wantsHikingWear = /(등산복|등산|아웃도어|트레킹|하이킹|hiking|outdoor)/i.test(normalized);
  const wantsRedColor = /(붉은|붉|빨강|빨간|레드|red)/i.test(normalized);
  const budgetMax = parseBudgetUpperBoundKrw(message);
  const preferInch = parsePreferredInch(message);
  const excludeRental = /(렌탈\s*(제외|빼|없이|x)|일시불|일시\s*불)/i.test(normalized);
  const sortPriceAsc =
    /(최저|저렴|가장\s*싼|price\s*(ascending|low|lowest)|낮은\s*가격|가격\s*낮은|가격순|cheap|cheapest)/i.test(
      normalized
    );
  const listingPathHints = extractListingPathHints(message);
  const requiredKeywords = extractRequiredKeywords(message);
  const explicitCategoryNavigation = /(메뉴|카테고리|category|navigation|nav|browse|전체메뉴|전체\s*카테고리)/i.test(
    normalized
  );

  const listingFilter =
    wantsWomenWear || wantsHikingWear || wantsRedColor || budgetMax != null || preferInch != null || excludeRental
      ? {
          requireWomenWear: wantsWomenWear || /여성스포츠의류/i.test(normalized),
          requireHikingWear: wantsHikingWear,
          requireRedColor: wantsRedColor,
          maxLumpSum: budgetMax,
          preferInch,
          excludeRental
        }
      : undefined;

  const hasListingKeyword = /(메뉴|카테고리|category|쇼핑|상품|product|제품|검색|search|정렬|filter|필터|price|가격|최저|저렴|비교|찾아|find|리스트|리스팅|listing|list)/i.test(
    normalized
  );
  const wantsListingNavigation =
    hasListingKeyword ||
    listingPathHints.length > 0 ||
    sortPriceAsc ||
    Boolean(listingFilter);
  const listingModeLabel = sortPriceAsc
    ? preferInch != null
      ? 'listing-price-asc-size-preferred'
      : 'listing-price-asc'
    : listingFilter
      ? 'listing-filtered'
      : undefined;
  const searchQuery = buildSearchQueryFromIntent(message, requiredKeywords, listingFilter);
  const searchQueryVariants = buildSearchQueryVariants(
    searchQuery,
    requiredKeywords,
    listingPathHints,
    listingFilter
  );
  const hierarchyHintGroups = buildHierarchyHintGroups(
    message,
    listingFilter,
    requiredKeywords,
    listingPathHints,
    explicitCategoryNavigation
  );
  const resultExpectation = buildResultExpectation(message, listingFilter, requiredKeywords);

  const wantsSummary =
    /(요약|간추|정리|summary|summarize|important|중요|핵심|목록|나열|리스트|리스팅|list|listing)/i.test(
      normalized
    ) ||
    wantsListingNavigation;
  return {
    wantsListingNavigation,
    explicitCategoryNavigation,
    listingPathHints,
    hierarchyHintGroups,
    requiredKeywords,
    searchQuery,
    searchQueryVariants,
    resultExpectation,
    listingFilter,
    listingModeLabel,
    sortPriceAsc,
    wantsSummary,
    summaryCount: parseSummaryCount(message)
  };
}

function detectSiteType(targetUrl: string, message: string): string {
  const normalized = normalizeMessage(message);
  const hostname = (() => {
    try {
      return new URL(targetUrl).hostname.toLowerCase();
    } catch {
      return '';
    }
  })();
  const pathname = (() => {
    try {
      return new URL(targetUrl).pathname.toLowerCase();
    } catch {
      return '';
    }
  })();
  const ecommerceHostSignal = /(shopping|shop|store|mall|mart|market|commerce|product|goods|item)/i.test(
    hostname
  );
  const ecommercePathSignal = /(\/shop|\/store|\/product|\/goods|\/item|\/category|\/mall|\/market)/i.test(
    pathname
  );
  const ecommerceTextSignal = /(쇼핑|상품|가격|카테고리|리스팅|리스트|비교|최저|저렴)/i.test(normalized);
  if (
    ecommerceHostSignal ||
    ecommercePathSignal ||
    ecommerceTextSignal
  ) {
    return 'ecommerce_listing';
  }
  if (/(news|뉴스|기사)/i.test(hostname) || /(뉴스|기사|요약|핵심)/i.test(normalized)) {
    return 'news_content';
  }
  if (/(map|지도)/i.test(hostname) || /(지도|경로|근처|검색)/i.test(normalized)) {
    return 'map_search';
  }
  return 'generic_web';
}

function buildRuleTaskAnalysis(task: ChatAutomationTask, intent: TaskIntent): TaskAnalysis {
  const targetUrl = detectSiteFromMessage(task.content);
  const must: string[] = [];
  const prefer: string[] = [];
  const avoid: string[] = [];
  if (intent.listingFilter?.requireWomenWear) {
    must.push('women_apparel');
  }
  if (intent.listingFilter?.requireHikingWear) {
    must.push('hiking_or_outdoor_apparel');
  }
  if (intent.listingFilter?.requireRedColor) {
    must.push('red_color_item');
  }
  if (
    typeof intent.listingFilter?.maxLumpSum === 'number' &&
    Number.isFinite(intent.listingFilter.maxLumpSum) &&
    intent.listingFilter.maxLumpSum > 0
  ) {
    must.push(`budget_lte_${intent.listingFilter.maxLumpSum}_krw`);
  }
  if (intent.requiredKeywords.length > 0) {
    prefer.push(...intent.requiredKeywords.map((row) => `keyword:${row}`));
  }
  if (intent.resultExpectation?.avoidAny.length) {
    avoid.push(...intent.resultExpectation.avoidAny.slice(0, 6).map((row) => `avoid:${row}`));
  }

  const hierarchyText = intent.hierarchyHintGroups
    .map((group, index) => `L${index + 1}=${group.join('/')}`)
    .join(' -> ');
  const stagedApproach = intent.wantsListingNavigation
    ? [
        'Open homepage and locate global navigation or category entry points.',
        hierarchyText
          ? `Traverse category hierarchy step-by-step (${hierarchyText}).`
          : 'Traverse likely product categories from broad to specific.',
        'Apply constraints (price, gender, color, item type) from visible filters or query controls.',
        `If category route is blocked, run in-site search with query: ${intent.searchQuery || '(none)'}.`,
        'Extract concise candidates and validate they satisfy constraints before returning.'
      ]
    : [
        'Open target site and identify the relevant section for the request.',
        'Collect concise evidence and produce requested summary.'
      ];

  const strategyOptions: TaskAnalysisStrategyOption[] = [];
  if (intent.wantsListingNavigation) {
    strategyOptions.push({
      name: 'menu_first',
      whenToUse: 'category-heavy shopping page with discoverable navigation',
      steps: [
        'open main menu/category',
        'move from broad category to specific category',
        'apply filters/sort before extraction'
      ],
      risks: ['hidden menu behind hover/tab', 'labels differ by site']
    });
    strategyOptions.push({
      name: 'search_first',
      whenToUse: 'navigation labels are ambiguous or hard to locate',
      steps: ['focus site search', `search query: ${intent.searchQuery || '(none)'}`, 'filter/verify results'],
      risks: ['search recall may include mismatched accessories']
    });
    strategyOptions.push({
      name: 'hybrid',
      whenToUse: 'first strategy fails validation or confidence is low',
      steps: ['menu-first attempt', 'search-first attempt', 'cross-validate extracted candidate'],
      risks: ['higher step count', 'can repeat similar wrong cluster']
    });
  } else {
    strategyOptions.push({
      name: 'direct_then_verify',
      whenToUse: 'non-listing request with clear target',
      steps: ['direct navigation', 'perform requested interaction', 'verify final state'],
      risks: ['dynamic page variation']
    });
  }

  const hierarchySignalCount = intent.hierarchyHintGroups.filter((group) => group.length > 0).length;
  const hasStrictListingConstraints = Boolean(
    intent.listingFilter?.requireWomenWear ||
      intent.listingFilter?.requireHikingWear ||
      intent.listingFilter?.requireRedColor ||
      (typeof intent.listingFilter?.maxLumpSum === 'number' &&
        Number.isFinite(intent.listingFilter.maxLumpSum) &&
        intent.listingFilter.maxLumpSum > 0)
  );
  const recommendedStrategy =
    intent.wantsListingNavigation
      ? intent.explicitCategoryNavigation
        ? 'menu_first'
        : hierarchySignalCount >= 2 || hasStrictListingConstraints
          ? 'hybrid'
          : intent.searchQuery.trim().length > 0
            ? 'search_first'
            : 'hybrid'
      : 'direct_then_verify';

  return {
    source: 'rule',
    taskType: intent.wantsListingNavigation ? 'listing_and_filter' : intent.wantsSummary ? 'summary' : 'general_navigation',
    siteType: detectSiteType(targetUrl, task.content),
    goalSummary: task.content.trim().slice(0, 220),
    constraintBuckets: {
      must: uniqueStringList(must, 10),
      prefer: uniqueStringList(prefer, 10),
      avoid: uniqueStringList(avoid, 10)
    },
    stagedApproach,
    strategyOptions,
    recommendedStrategy,
    strategyRationale:
      recommendedStrategy === 'menu_first'
        ? 'User explicitly requested category/menu traversal, so category-first route is preferred.'
        : recommendedStrategy === 'hybrid' && (hierarchySignalCount >= 2 || hasStrictListingConstraints)
          ? 'Multiple category and filter constraints are present; menu-first navigation with search fallback is safer.'
        : recommendedStrategy === 'search_first'
          ? 'No explicit menu instruction; in-site search/filter provides safer first recall.'
        : recommendedStrategy === 'hybrid'
          ? 'Category labels may vary; hybrid keeps recall while preserving validation.'
          : 'Direct action is sufficient for non-listing objective.',
    confidence: 0.58
  };
}

function parseTaskAnalysisStrategyOptions(raw: unknown): TaskAnalysisStrategyOption[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const parsed: TaskAnalysisStrategyOption[] = [];
  for (const row of raw.slice(0, 5)) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      continue;
    }
    const record = row as Record<string, unknown>;
    const name = sanitizeTextValue(record.name, 80);
    const steps = sanitizeTextList(record.steps, 8, 140);
    if (!name || steps.length === 0) {
      continue;
    }
    parsed.push({
      name,
      whenToUse: sanitizeTextValue(record.whenToUse, 140),
      steps,
      risks: sanitizeTextList(record.risks, 8, 140)
    });
  }
  return parsed;
}

function parseTaskAnalysisFromPayload(
  payload: unknown,
  fallback: TaskAnalysis
): Omit<TaskAnalysis, 'source' | 'tier' | 'provider' | 'model'> {
  if (!payload || typeof payload !== 'object') {
    throw new Error('task analysis payload is not object');
  }
  const record = payload as Record<string, unknown>;
  const rawBuckets =
    record.constraintBuckets && typeof record.constraintBuckets === 'object' && !Array.isArray(record.constraintBuckets)
      ? (record.constraintBuckets as Record<string, unknown>)
      : undefined;
  const must = rawBuckets ? sanitizeTextList(rawBuckets.must, 12, 140) : [];
  const prefer = rawBuckets ? sanitizeTextList(rawBuckets.prefer, 12, 140) : [];
  const avoid = rawBuckets ? sanitizeTextList(rawBuckets.avoid, 12, 140) : [];
  const strategyOptions = parseTaskAnalysisStrategyOptions(record.strategyOptions);
  const optionNames = strategyOptions.map((row) => row.name.toLowerCase());
  const recommended = sanitizeTextValue(record.recommendedStrategy, 80);
  const confidence = parseConfidence(record.confidence, fallback.confidence);

  return {
    taskType: sanitizeTextValue(record.taskType, 80) ?? fallback.taskType,
    siteType: sanitizeTextValue(record.siteType, 80) ?? fallback.siteType,
    goalSummary: sanitizeTextValue(record.goalSummary, 280) ?? fallback.goalSummary,
    constraintBuckets: {
      must: must.length > 0 ? must : fallback.constraintBuckets.must,
      prefer: prefer.length > 0 ? prefer : fallback.constraintBuckets.prefer,
      avoid: avoid.length > 0 ? avoid : fallback.constraintBuckets.avoid
    },
    stagedApproach: (() => {
      const rows = sanitizeTextList(record.stagedApproach, 10, 160);
      return rows.length > 0 ? rows : fallback.stagedApproach;
    })(),
    strategyOptions: strategyOptions.length > 0 ? strategyOptions : fallback.strategyOptions,
    recommendedStrategy:
      recommended && optionNames.some((row) => row === recommended.toLowerCase())
        ? recommended
        : fallback.recommendedStrategy,
    strategyRationale: sanitizeTextValue(record.strategyRationale, 220) ?? fallback.strategyRationale,
    confidence
  };
}

function parseTaskAnalysisFromRaw(
  raw: string,
  fallback: TaskAnalysis
): Omit<TaskAnalysis, 'source' | 'tier' | 'provider' | 'model'> {
  const json = extractFirstJsonObject(raw);
  if (!json) {
    throw new Error('task analysis output has no JSON object');
  }
  let payload: unknown;
  try {
    payload = JSON.parse(json) as unknown;
  } catch {
    throw new Error('task analysis JSON parse failed');
  }
  return parseTaskAnalysisFromPayload(payload, fallback);
}

function buildListingPageSummaryOptions(intent: TaskIntent):
  | {
      listing: {
        filter?: {
          requireWomenWear?: boolean;
          requireHikingWear?: boolean;
          requireRedColor?: boolean;
          maxLumpSum?: number;
          preferInch?: number;
          excludeRental?: boolean;
        };
        modeLabel?: string;
      };
    }
  | undefined {
  if (!intent.wantsListingNavigation) {
    return undefined;
  }

  return {
    listing: {
      filter: intent.listingFilter,
      modeLabel: intent.listingModeLabel
    }
  };
}

function summaryPreview(summary: string, maxLines = 3): string {
  const rows = summary
    .split('\n')
    .map((row) => row.trim())
    .filter((row) => row.length > 0)
    .slice(0, Math.max(1, maxLines));
  return rows.join(' | ');
}

function nowIso(): string {
  return new Date().toISOString();
}

function isSessionMissingError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.startsWith('session not found:');
}

function buildRunState(now: string): ChatAutomationRunState {
  return {
    status: 'idle',
    step: 0,
    totalSteps: 0,
    updatedAt: now,
    waitingCaptcha: false,
    queueLength: 0
  };
}

function detectSiteFromMessage(message: string): string {
  const trimTail = (value: string): string => value.replace(/[),.!?]+$/g, '');
  const urlMatch = message.match(/https?:\/\/[^\s)]+/i);
  if (urlMatch) {
    return trimTail(urlMatch[0]!);
  }

  const domainPattern = /((?:www\.)?(?:[a-z0-9-]+\.)+[a-z]{2,})(\/[^\s)]*)?/gi;
  for (const match of message.matchAll(domainPattern)) {
    const host = (match[1] ?? '').toLowerCase();
    const path = trimTail(match[2] ?? '');
    const index = match.index ?? 0;
    if (index > 0 && message[index - 1] === '@') {
      continue;
    }
    if (!host) {
      continue;
    }
    return `https://${host}${path}`;
  }

  return 'https://example.com';
}

function detectDomainFromMessage(message: string): string | undefined {
  const site = detectSiteFromMessage(message);
  try {
    return new URL(site).hostname;
  } catch {
    return undefined;
  }
}

function parseUrlSafe(raw: string | undefined): URL | undefined {
  if (!raw) {
    return undefined;
  }
  try {
    return new URL(raw);
  } catch {
    return undefined;
  }
}

function isRootHomepageUrl(raw: string | undefined): boolean {
  const parsed = parseUrlSafe(raw);
  if (!parsed) {
    return false;
  }
  const pathname = parsed.pathname.replace(/\/+$/g, '') || '/';
  if (pathname !== '/') {
    return false;
  }
  return parsed.searchParams.toString().length === 0;
}

function sameHostFamily(leftRaw: string | undefined, rightRaw: string | undefined): boolean {
  const left = parseUrlSafe(leftRaw);
  const right = parseUrlSafe(rightRaw);
  if (!left || !right) {
    return false;
  }
  const lh = left.hostname.toLowerCase();
  const rh = right.hostname.toLowerCase();
  return lh === rh || lh.endsWith(`.${rh}`) || rh.endsWith(`.${lh}`);
}

function isListingOrSearchLikeUrl(raw: string | undefined): boolean {
  const parsed = parseUrlSafe(raw);
  if (!parsed) {
    return false;
  }
  const signal = `${parsed.hostname}${parsed.pathname}${parsed.search}`.toLowerCase();
  return /\/list(\/|\?|$)|\/search(\/|\?|$)|dsearch\.php|(?:^|[?&])(q|query|search|keyword|cate|category|cat|sort)=/i.test(
    signal
  );
}

function needsCaptchaInput(message: string): boolean {
  return /(captcha|로그인|인증|verification|otp|2fa)/i.test(message);
}

function needsSimilarImageSearch(message: string): boolean {
  return /(비슷|유사|similar|look\s*alike|닮은)/i.test(message);
}

function resolvePlannerMode(): PlannerMode {
  const raw = (process.env.CHAT_AUTOMATION_PLANNER_MODE ?? 'llm_first').trim().toLowerCase();
  return raw === 'rule_first' ? 'rule_first' : 'llm_first';
}

function resolveChatAutomationAllowProEscalation(): boolean {
  const raw = (process.env.CHAT_AUTOMATION_ALLOW_PRO_ESCALATION ?? '0').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes';
}

function resolveAutomationPlannerTiers(): PlannerTier[] {
  return resolveChatAutomationAllowProEscalation() ? ['flash', 'pro'] : ['flash'];
}

function resolvePlannerMaxAttempts(): number {
  const raw = parseOptionalNumber(process.env.CHAT_AUTOMATION_MAX_PLANNER_ATTEMPTS);
  if (!raw || !Number.isFinite(raw)) {
    return 4;
  }
  return Math.max(1, Math.min(8, Math.floor(raw)));
}

function resolveSearchFallbackStartAttempt(): number {
  const raw = parseOptionalNumber(process.env.CHAT_AUTOMATION_SEARCH_FALLBACK_START_ATTEMPT);
  if (!raw || !Number.isFinite(raw)) {
    return 3;
  }
  return Math.max(2, Math.min(6, Math.floor(raw)));
}

function resolveCategoryContextMinHintSignals(): number {
  const raw = parseOptionalNumber(process.env.CHAT_AUTOMATION_MIN_HINT_SIGNALS_FOR_CONTEXT);
  if (!raw || !Number.isFinite(raw)) {
    return 4;
  }
  return Math.max(1, Math.min(6, Math.floor(raw)));
}

function resolveHintNavigateMaxPathSteps(
  intent: TaskIntent,
  action: Extract<PlannerAction, { kind: 'hint_navigate' }>
): number {
  const configured = parseOptionalNumber(process.env.CHAT_AUTOMATION_HINT_MAX_PATH_STEPS);
  let maxSteps = !configured || !Number.isFinite(configured) ? 5 : Math.floor(configured);

  const hierarchyDepth = intent.hierarchyHintGroups.filter((group) => group.length > 0).length;
  const strictFilter = Boolean(
    intent.listingFilter?.requireWomenWear ||
      intent.listingFilter?.requireHikingWear ||
      intent.listingFilter?.requireRedColor ||
      (typeof intent.listingFilter?.maxLumpSum === 'number' &&
        Number.isFinite(intent.listingFilter.maxLumpSum) &&
        intent.listingFilter.maxLumpSum > 0)
  );

  if (intent.explicitCategoryNavigation) {
    maxSteps = Math.max(maxSteps, 6);
  }
  if (hierarchyDepth >= 3 || strictFilter) {
    maxSteps = Math.max(maxSteps, 7);
  }
  maxSteps = Math.max(maxSteps, Math.min(10, action.hints.length + 2));

  return Math.max(3, Math.min(12, maxSteps));
}

function resolvePlannerMaxActions(): number {
  const raw = parseOptionalNumber(process.env.CHAT_AUTOMATION_MAX_PLANNER_ACTIONS);
  if (!raw || !Number.isFinite(raw)) {
    return 18;
  }
  return Math.max(5, Math.min(30, Math.floor(raw)));
}

function sanitizeTextValue(raw: unknown, maxLen: number): string | undefined {
  if (typeof raw !== 'string') {
    return undefined;
  }
  const value = raw.trim().replace(/\s+/g, ' ');
  if (value.length === 0) {
    return undefined;
  }
  return value.slice(0, maxLen);
}

function sanitizeTextList(raw: unknown, maxItems: number, maxLen: number): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const seen = new Set<string>();
  const rows: string[] = [];
  for (const entry of raw) {
    const value = sanitizeTextValue(entry, maxLen);
    if (!value) {
      continue;
    }
    const key = value.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    rows.push(value);
    if (rows.length >= maxItems) {
      break;
    }
  }
  return rows;
}

function sanitizeHttpUrl(raw: unknown): string | undefined {
  if (typeof raw !== 'string') {
    return undefined;
  }
  const value = raw.trim();
  if (!value) {
    return undefined;
  }
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return undefined;
    }
    return parsed.toString();
  } catch {
    return undefined;
  }
}

function isUnsafePlannerSelector(raw: string): boolean {
  const selector = raw.trim();
  if (!selector) {
    return true;
  }
  if (selector.length > 160) {
    return true;
  }
  if (/^\*$/.test(selector)) {
    return true;
  }
  if (/^[a-z][a-z0-9-]*$/i.test(selector)) {
    return true;
  }
  if (/^\.[a-z0-9_-]+$/i.test(selector)) {
    return true;
  }
  if (/^[a-z][a-z0-9-]*(\.[a-z0-9_-]+){1,2}$/i.test(selector)) {
    return true;
  }
  if (/^[a-z][a-z0-9-]*\[[^\]]+\]$/i.test(selector) && !/\[(id|data-[a-z0-9_-]+|aria-[a-z0-9_-]+)=/i.test(selector)) {
    return true;
  }
  if (/^(html|body|main|section|article|header|footer|nav|ul|ol|li|div|span|p|a|button|input|form)$/i.test(selector)) {
    return true;
  }
  return false;
}

function extractFirstJsonObject(raw: string): string | undefined {
  const text = raw.trim();
  if (!text) {
    return undefined;
  }

  const starts: number[] = [];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '{') {
      starts.push(index);
    }
  }

  for (const start of starts) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < text.length; index += 1) {
      const ch = text[index]!;
      if (inString) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (ch === '\\') {
          escaped = true;
          continue;
        }
        if (ch === '"') {
          inString = false;
        }
        continue;
      }

      if (ch === '"') {
        inString = true;
        continue;
      }
      if (ch === '{') {
        depth += 1;
        continue;
      }
      if (ch === '}') {
        depth -= 1;
        if (depth === 0) {
          return text.slice(start, index + 1);
        }
      }
    }
  }

  return undefined;
}

function parsePlannerActionsFromPayload(
  payload: unknown,
  summaryFallbackMaxItems: number
): { actions: PlannerAction[]; notes?: string } {
  if (!payload || typeof payload !== 'object') {
    throw new Error('planner payload is not object');
  }

  const record = payload as Record<string, unknown>;
  const actionsRaw = Array.isArray(record.actions) ? record.actions : [];
  const actions: PlannerAction[] = [];

  const maxActions = resolvePlannerMaxActions();
  for (const row of actionsRaw.slice(0, maxActions)) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      continue;
    }
    const action = row as Record<string, unknown>;
    const kind = sanitizeTextValue(action.kind, 64)?.toLowerCase();
    const reason = sanitizeTextValue(action.reason, 160);
    if (!kind) {
      continue;
    }

    if (kind === 'navigate') {
      const url = sanitizeHttpUrl(action.url);
      if (!url) {
        continue;
      }
      actions.push({ kind: 'navigate', url, reason });
      continue;
    }

    if (kind === 'hint_navigate') {
      const hints = sanitizeTextList(action.hints, 8, 48);
      if (hints.length === 0) {
        continue;
      }
      actions.push({
        kind: 'hint_navigate',
        hints,
        sortPriceAsc: Boolean(action.sortPriceAsc),
        reason
      });
      continue;
    }

    if (kind === 'click') {
      const selectors = sanitizeTextList(action.selectors, 6, 160).filter((selector) => !isUnsafePlannerSelector(selector));
      const textHints = sanitizeTextList(action.textHints, 6, 64);
      if (selectors.length === 0 && textHints.length === 0) {
        continue;
      }
      actions.push({
        kind: 'click',
        selectors: selectors.length > 0 ? selectors : undefined,
        textHints: textHints.length > 0 ? textHints : undefined,
        label: sanitizeTextValue(action.label, 64),
        reason
      });
      continue;
    }

    if (kind === 'type') {
      const selectors = sanitizeTextList(action.selectors, 6, 160).filter((selector) => !isUnsafePlannerSelector(selector));
      const textHints = sanitizeTextList(action.textHints, 6, 64);
      const value = sanitizeTextValue(action.value, 400);
      if (!value || (selectors.length === 0 && textHints.length === 0)) {
        continue;
      }
      actions.push({
        kind: 'type',
        selectors: selectors.length > 0 ? selectors : undefined,
        textHints: textHints.length > 0 ? textHints : undefined,
        value,
        submit: Boolean(action.submit),
        label: sanitizeTextValue(action.label, 64),
        reason
      });
      continue;
    }

    if (kind === 'wait') {
      const value = Number(action.ms);
      if (!Number.isFinite(value)) {
        continue;
      }
      actions.push({
        kind: 'wait',
        ms: Math.max(100, Math.min(15_000, Math.floor(value))),
        reason
      });
      continue;
    }

    if (kind === 'summarize') {
      const value = Number(action.maxItems);
      const maxItems =
        Number.isFinite(value) && value > 0 ? Math.min(10, Math.max(1, Math.floor(value))) : summaryFallbackMaxItems;
      actions.push({
        kind: 'summarize',
        maxItems,
        reason
      });
      continue;
    }

    if (kind === 'handoff') {
      const handoffTypeRaw = sanitizeTextValue(action.handoffType, 64)?.toLowerCase();
      const handoffType: ChatAutomationHandoffType =
        handoffTypeRaw === 'security_challenge' ? 'security_challenge' : 'captcha';
      const prompt = sanitizeTextValue(action.prompt, 240) ?? 'User input required to continue safely.';
      actions.push({
        kind: 'handoff',
        handoffType,
        prompt,
        reason
      });
      continue;
    }

    if (kind === 'noop') {
      actions.push({
        kind: 'noop',
        reason
      });
      continue;
    }
  }

  const notes = sanitizeTextValue(record.notes, 200);

  if (actions.length === 0) {
    return {
      actions: [{ kind: 'noop', reason: 'planner_returned_no_actions' }],
      notes
    };
  }

  return {
    actions,
    notes
  };
}

function parsePlannerActionsFromRaw(
  raw: string,
  summaryFallbackMaxItems: number
): { actions: PlannerAction[]; notes?: string } {
  const json = extractFirstJsonObject(raw);
  if (!json) {
    throw new Error('planner output has no JSON object');
  }
  let payload: unknown;
  try {
    payload = JSON.parse(json) as unknown;
  } catch {
    throw new Error('planner JSON parse failed');
  }
  return parsePlannerActionsFromPayload(payload, summaryFallbackMaxItems);
}

function buildRuleFallbackPlannerPlan(intent: TaskIntent, preferredStrategy?: string): PlannerPlan {
  const actions: PlannerAction[] = [];
  if (intent.wantsListingNavigation) {
    const strategy = (preferredStrategy ?? '').trim().toLowerCase();
    const hierarchyGroups = intent.hierarchyHintGroups
      .map((group) => uniqueStringList(group, 6))
      .filter((group) => group.length > 0)
      .filter((group) => shouldAllowNavigationRootHints(intent) || !isNavigationRootOnlyGroup(group));
    const queryFallback =
      intent.searchQueryVariants[0] ??
      intent.searchQuery ??
      intent.requiredKeywords.slice(0, 3).join(' ') ??
      '';

    const addMenuFlow = (): void => {
      if (hierarchyGroups.length > 0) {
        hierarchyGroups.slice(0, 4).forEach((group, index) => {
          actions.push({
            kind: 'hint_navigate',
            hints: group.slice(0, 6),
            sortPriceAsc: index === hierarchyGroups.length - 1 ? intent.sortPriceAsc : false,
            reason: index === 0 ? 'rule_fallback_hierarchy_root' : `rule_fallback_hierarchy_level_${index + 1}`
          });
        });
        return;
      }

      if (intent.listingPathHints.length > 0) {
        actions.push({
          kind: 'hint_navigate',
          hints: intent.listingPathHints.slice(0, 6),
          sortPriceAsc: intent.sortPriceAsc,
          reason: 'rule_fallback_listing_navigation'
        });
      }
    };

    const addSearchFlow = (): void => {
      if (queryFallback.trim().length === 0) {
        return;
      }
      actions.push({
        kind: 'click',
        textHints: ['검색', 'search', '상품검색'],
        label: 'fallback-search-focus',
        reason: 'rule_fallback_search_probe'
      });
      actions.push({
        kind: 'type',
        textHints: ['검색', 'search', '상품검색'],
        value: queryFallback,
        submit: true,
        label: 'fallback-search-submit',
        reason: 'rule_fallback_search_probe'
      });
      actions.push({
        kind: 'wait',
        ms: 1000,
        reason: 'rule_fallback_search_probe'
      });
    };

    if (strategy === 'search_first') {
      addSearchFlow();
      if (intent.explicitCategoryNavigation) {
        addMenuFlow();
      }
      appendConstraintProbeActions(actions, intent, 'rule_fallback_constraint_probe');
    } else if (strategy === 'menu_first') {
      addMenuFlow();
      appendConstraintProbeActions(actions, intent, 'rule_fallback_constraint_probe');
      addSearchFlow();
    } else if (strategy === 'hybrid') {
      if (intent.explicitCategoryNavigation || hierarchyGroups.length > 0) {
        addMenuFlow();
      }
      appendConstraintProbeActions(actions, intent, 'rule_fallback_constraint_probe');
      addSearchFlow();
    } else {
      if (intent.explicitCategoryNavigation || hierarchyGroups.length > 0) {
        addMenuFlow();
      }
      appendConstraintProbeActions(actions, intent, 'rule_fallback_constraint_probe');
      addSearchFlow();
    }
  }
  if (intent.wantsSummary) {
    actions.push({
      kind: 'summarize',
      maxItems: intent.summaryCount,
      reason: 'rule_fallback_summary'
    });
  }
  if (actions.length === 0) {
    actions.push({
      kind: 'noop',
      reason: 'rule_fallback_no_matching_intent'
    });
  }
  return {
    source: 'rule_fallback',
    actions,
    notes: 'fallback_without_llm_or_validation_failure'
  };
}

function parseConfidence(raw: unknown, fallback = 0.5): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return Math.max(0, Math.min(1, raw));
  }
  return fallback;
}

function parseResultValidationFromRaw(raw: string): Omit<ResultValidation, 'source' | 'tier' | 'provider' | 'model'> {
  const json = extractFirstJsonObject(raw);
  if (!json) {
    throw new Error('validation output has no JSON object');
  }
  let payload: unknown;
  try {
    payload = JSON.parse(json) as unknown;
  } catch {
    throw new Error('validation JSON parse failed');
  }
  if (!payload || typeof payload !== 'object') {
    throw new Error('validation payload is not object');
  }
  const record = payload as Record<string, unknown>;
  const valid = Boolean(record.valid);
  const confidence = parseConfidence(record.confidence, valid ? 0.75 : 0.4);
  const reason =
    sanitizeTextValue(record.reason, 220) ?? (valid ? 'validated_by_llm' : 'validation_failed_by_llm');
  const missingConstraints = sanitizeTextList(record.missingConstraints, 8, 100);
  const retryHints = sanitizeTextList(record.retryHints, 8, 100);
  return {
    valid,
    confidence,
    reason,
    missingConstraints,
    retryHints
  };
}

function normalizeAttachments(raw: ChatMessageAttachmentInput[] | undefined): ChatMessageAttachment[] {
  if (!raw || raw.length === 0) {
    return [];
  }

  const normalized: ChatMessageAttachment[] = [];
  for (const entry of raw) {
    const name = (entry.name ?? '').trim();
    const source = entry.source ?? (entry.url ? 'url' : entry.path ? 'path' : 'upload');

    if (source === 'url') {
      const url = (entry.url ?? '').trim();
      if (!url) {
        continue;
      }
      normalized.push({
        name: name || 'attachment-url',
        mimeType: entry.mimeType,
        source,
        url,
        sizeBytes: entry.sizeBytes
      });
      continue;
    }

    const path = (entry.path ?? '').trim();
    if (!path) {
      continue;
    }
    normalized.push({
      name: name || 'attachment-image',
      mimeType: entry.mimeType,
      source,
      path,
      sizeBytes: entry.sizeBytes
    });
  }

  return normalized;
}

function buildStepPlan(message: string, attachments: ChatMessageAttachment[]): RuntimeStep[] {
  const steps: RuntimeStep[] = [
    { kind: 'analysis', title: 'Analyze user objective and extract constraints' },
    { kind: 'browser', title: 'Prepare browser runtime and execution mode' },
    {
      kind: 'navigate',
      title: `Navigate target site ${detectSiteFromMessage(message)}`
    },
    { kind: 'listing', title: 'Inspect listing/repeated items and select candidate actions' },
    { kind: 'verify', title: 'Verify outcome and prepare next turn summary' }
  ];

  if (attachments.length > 0) {
    steps.splice(3, 0, {
      kind: 'attachment_analysis',
      title: `Analyze ${attachments.length} attached image(s) and extract visual descriptors`
    });

    if (needsSimilarImageSearch(message)) {
      steps.splice(4, 0, {
        kind: 'image_search',
        title: 'Prepare image-based lookup flow with attached reference'
      });
    }
  }

  if (needsCaptchaInput(message)) {
    steps.splice(Math.min(steps.length - 1, 3 + (attachments.length > 0 ? 1 : 0)), 0, {
      kind: 'captcha',
      title: 'Captcha / security challenge requires user input'
    });
  }

  return steps;
}

function toPlanCacheSteps(steps: RuntimeStep[]): PlanCacheStep[] {
  return steps.map((step) => ({
    kind: step.kind,
    title: step.title
  }));
}

function asCreateSessionInput(input: CreateChatSessionInput): CreateSessionInput {
  return {
    mode: 'backend_simple',
    title: input.title,
    workflowId: input.workflowId,
    tags: input.tags,
    metadata: {
      ...(input.metadata ?? {}),
      operatorId: input.operatorId ?? 'default-operator'
    },
    systemPrompt: input.systemPrompt
  };
}

export type ChatAutomationSessionUpdateListener = (
  snapshot: ChatAutomationSessionSnapshot
) => void;
export type ChatAutomationProgressListener = (event: ChatAutomationProgressEvent) => void;

export class ChatAutomationService {
  private readonly store: SessionStore;
  private readonly stepDelayMs: number;
  private readonly logTailSize: number;
  private readonly telemetry: LangfuseTelemetry;
  private telemetryInitWarningLogged = false;
  private readonly plannerMode: PlannerMode;
  private readonly planCacheEnabled: boolean;
  private readonly planCache: PlanCache;
  private readonly executionMode: ChatAutomationExecutionMode;
  private readonly runtimeScreenshotRoot: string;
  private readonly screenshotHistoryLimit = 60;
  private readonly emitter = new EventEmitter();
  private readonly runtime = new Map<string, SessionRuntimeState>();

  constructor(options: ChatAutomationServiceOptions) {
    this.store = options.store;
    this.stepDelayMs = Math.max(1, Math.floor(options.stepDelayMs ?? 450));
    this.logTailSize = Math.max(20, Math.floor(options.logTailSize ?? 300));
    this.telemetry = getLangfuseTelemetry();
    this.plannerMode = resolvePlannerMode();
    this.planCacheEnabled = options.planCacheEnabled ?? process.env.PLAN_CACHE_ENABLED === '1';
    const similarityThreshold =
      options.planCacheSimilarityThreshold ?? parseOptionalNumber(process.env.PLAN_CACHE_SIMILARITY_THRESHOLD);
    this.planCache = new PlanCache({
      similarityThreshold
    });
    this.executionMode =
      options.executionMode ??
      (process.env.CHAT_AUTOMATION_EXECUTION_MODE === 'playwright' ? 'playwright' : 'simulate');
    this.runtimeScreenshotRoot =
      options.runtimeScreenshotRoot ??
      process.env.CHAT_AUTOMATION_RUNTIME_SCREENSHOT_ROOT ??
      resolve(process.cwd(), 'testing', 'chat-automation', 'runtime-shots');
  }

  async init(): Promise<void> {
    const sessions = await this.store.list();

    for (const session of sessions) {
      const operatorId = String(session.metadata?.operatorId ?? 'default-operator');
      this.runtime.set(session.id, {
        sessionId: session.id,
        operatorId,
        run: buildRunState(nowIso()),
        queue: [],
        logs: [],
        workerRunning: false,
        paused: false,
        canceled: false,
        handoffs: [],
        screenshotHistory: []
      });
    }
  }

  private stateEvent(sessionId: string): string {
    return `session:${sessionId}`;
  }

  private progressEvent(): string {
    return 'progress:any';
  }

  private ensureRuntime(session: AutomationSession): SessionRuntimeState {
    const current = this.runtime.get(session.id);
    if (current) {
      return current;
    }

    const created: SessionRuntimeState = {
      sessionId: session.id,
      operatorId: String(session.metadata?.operatorId ?? 'default-operator'),
      run: buildRunState(nowIso()),
      queue: [],
      logs: [],
      workerRunning: false,
      paused: false,
      canceled: false,
      handoffs: [],
      screenshotHistory: []
    };
    this.runtime.set(session.id, created);
    return created;
  }

  private async mustGetSession(sessionId: string): Promise<AutomationSession> {
    const session = await this.store.get(sessionId);
    if (!session) {
      throw new Error(`session not found: ${sessionId}`);
    }
    return session;
  }

  private tailLogs(logs: ChatAutomationLogEntry[]): ChatAutomationLogEntry[] {
    return logs.slice(Math.max(0, logs.length - this.logTailSize));
  }

  private log(state: SessionRuntimeState, level: ChatAutomationLogLevel, message: string): void {
    const entry: ChatAutomationLogEntry = {
      id: `${state.sessionId}-log-${state.logs.length + 1}`,
      at: nowIso(),
      level,
      message
    };

    state.logs.push(entry);
    state.logs = this.tailLogs(state.logs);
    state.run.updatedAt = entry.at;
  }

  private async appendTurn(
    sessionId: string,
    input: AddSessionTurnInput
  ): Promise<{ session: AutomationSession; turn: SessionTurn }> {
    const session = await this.store.appendTurn(sessionId, input);
    const turn = session.turns[session.turns.length - 1];
    if (!turn) {
      throw new Error(`session has no turn: ${sessionId}`);
    }

    return {
      session,
      turn
    };
  }

  private async emitSnapshot(sessionId: string): Promise<void> {
    const snapshot = await this.getSnapshot(sessionId);
    const runtime = this.ensureRuntime(snapshot.session);
    const progressEvent: ChatAutomationProgressEvent = {
      schemaVersion: 'chat.progress.event.v1',
      eventType: 'session_snapshot',
      emittedAt: nowIso(),
      sessionId: snapshot.session.id,
      operatorId: runtime.operatorId,
      runStatus: snapshot.run.status,
      snapshot
    };
    this.emitter.emit(this.stateEvent(sessionId), snapshot);
    this.emitter.emit(this.progressEvent(), progressEvent);
  }

  onSessionUpdate(sessionId: string, listener: ChatAutomationSessionUpdateListener): () => void {
    const event = this.stateEvent(sessionId);
    this.emitter.on(event, listener);
    return () => {
      this.emitter.off(event, listener);
    };
  }

  onProgress(listener: ChatAutomationProgressListener): () => void {
    const event = this.progressEvent();
    this.emitter.on(event, listener);
    return () => {
      this.emitter.off(event, listener);
    };
  }

  private resolvePlan(task: ChatAutomationTask): {
    steps: RuntimeStep[];
    cacheHit: boolean;
    score?: number;
    templateId?: string;
  } {
    const generated = buildStepPlan(task.content, task.attachments);
    if (!this.planCacheEnabled) {
      return { steps: generated, cacheHit: false };
    }

    const workflowId = 'chat-automation-default';
    const domain = detectDomainFromMessage(task.content);
    const match = this.planCache.findBestMatch({
      workflowId,
      goal: task.content,
      domain
    });

    if (!match) {
      return { steps: generated, cacheHit: false };
    }

    const adapted = this.planCache.adaptSteps(match.template, {
      goal: task.content,
      domain
    });

    const steps: RuntimeStep[] = adapted.map((step) => ({
      kind: step.kind as RuntimeStep['kind'],
      title: step.title
    }));
    if (steps.length === 0) {
      return { steps: generated, cacheHit: false };
    }

    return {
      steps,
      cacheHit: true,
      score: match.score,
      templateId: match.template.id
    };
  }

  async createSession(input: CreateChatSessionInput = {}): Promise<ChatAutomationSessionSnapshot> {
    const created = await this.store.create(asCreateSessionInput(input));
    const state = this.ensureRuntime(created);
    state.operatorId = input.operatorId ?? state.operatorId;
    state.run.updatedAt = nowIso();

    this.log(state, 'info', 'Session created');
    await this.emitSnapshot(created.id);
    return this.getSnapshot(created.id);
  }

  async listSessions(): Promise<ChatAutomationSessionSummary[]> {
    const sessions = await this.store.list();

    return sessions
      .map((session) => {
        const state = this.ensureRuntime(session);
        return {
          sessionId: session.id,
          title: session.title,
          operatorId: state.operatorId,
          runStatus: state.run.status,
          browserMode: state.run.browserMode,
          updatedAt:
            state.run.updatedAt.localeCompare(session.updatedAt) > 0
              ? state.run.updatedAt
              : session.updatedAt,
          queueLength: state.queue.length
        } satisfies ChatAutomationSessionSummary;
      })
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async getSnapshot(sessionId: string): Promise<ChatAutomationSessionSnapshot> {
    const session = await this.mustGetSession(sessionId);
    const state = this.ensureRuntime(session);
    state.run.queueLength = state.queue.length;

    return {
      schemaVersion: 'chat.session.snapshot.v1',
      emittedAt: nowIso(),
      session,
      run: {
        ...state.run,
        queueLength: state.queue.length
      },
      logs: [...state.logs],
      handoffs: [...state.handoffs],
      latestScreenshot: state.latestScreenshot,
      screenshotHistory: [...state.screenshotHistory]
    };
  }

  async listHandoffs(sessionId: string): Promise<ChatAutomationHandoff[]> {
    const session = await this.mustGetSession(sessionId);
    const state = this.ensureRuntime(session);
    return [...state.handoffs];
  }

  async getLatestScreenshot(sessionId: string): Promise<ChatAutomationScreenshotRef | undefined> {
    const session = await this.mustGetSession(sessionId);
    const state = this.ensureRuntime(session);
    return state.latestScreenshot;
  }

  async listScreenshotHistory(sessionId: string): Promise<ChatAutomationScreenshotRef[]> {
    const session = await this.mustGetSession(sessionId);
    const state = this.ensureRuntime(session);
    return [...state.screenshotHistory];
  }

  async getScreenshotByIndex(
    sessionId: string,
    index: number
  ): Promise<ChatAutomationScreenshotRef | undefined> {
    const history = await this.listScreenshotHistory(sessionId);
    if (history.length === 0) {
      return undefined;
    }
    const safeIndex = Math.max(0, Math.min(history.length - 1, Math.floor(index)));
    return history[safeIndex];
  }

  private recordScreenshot(state: SessionRuntimeState, ref: ChatAutomationScreenshotRef): void {
    state.latestScreenshot = ref;
    const last = state.screenshotHistory[state.screenshotHistory.length - 1];
    if (last?.path === ref.path) {
      return;
    }
    state.screenshotHistory.push(ref);
    if (state.screenshotHistory.length > this.screenshotHistoryLimit) {
      state.screenshotHistory = state.screenshotHistory.slice(
        Math.max(0, state.screenshotHistory.length - this.screenshotHistoryLimit)
      );
    }
  }

  private async pauseOtherSessions(operatorId: string, exceptSessionId: string): Promise<void> {
    for (const state of this.runtime.values()) {
      if (state.operatorId !== operatorId || state.sessionId === exceptSessionId) {
        continue;
      }

      if (state.run.status === 'running' || state.run.status === 'waiting_captcha') {
        state.paused = true;
        state.run.status = 'paused';
        this.log(state, 'warn', `Paused because operator switched to session ${exceptSessionId}`);
        await this.emitSnapshot(state.sessionId);
      }
    }
  }

  private async waitWhilePaused(state: SessionRuntimeState): Promise<void> {
    while (state.paused) {
      if (state.canceled) {
        return;
      }
      await sleep(120);
    }
  }

  private logDriverMessages(
    state: SessionRuntimeState,
    messages: Array<{ level: 'info' | 'warn' | 'error'; message: string }>
  ): PlannerActionExecutionSignal {
    const signal: PlannerActionExecutionSignal = {
      hintNavigateSuccess: 0,
      hintNavigateSkipped: 0,
      searchActionSucceeded: 0,
      searchActionSkipped: 0,
      filterActionSucceeded: 0,
      filterActionSkipped: 0,
      budgetFilterSucceeded: 0,
      colorFilterSucceeded: 0
    };
    for (const row of messages) {
      this.log(state, row.level, row.message);
      const message = row.message;
      if (
        /^Hint navigation ".*" via click:/i.test(message) ||
        /^Hint navigation hop \d+\/\d+:/i.test(message) ||
        /^Hint navigation hover expansion:/i.test(message) ||
        /^Weak navigation recovery succeeded:/i.test(message)
      ) {
        signal.hintNavigateSuccess += 1;
      }
      if (/^Hint navigation skipped:/i.test(message)) {
        signal.hintNavigateSkipped += 1;
      }
      if (row.level === 'info' && /^Action (click|type)\(/i.test(message)) {
        const searchMatched = /(search|검색|query|akcsearch)/i.test(message);
        const filterMatched = /(filter|필터|가격|price|budget|색상|color|red|레드|빨강)/i.test(message);
        if (searchMatched) {
          signal.searchActionSucceeded += 1;
        }
        if (filterMatched && !searchMatched) {
          signal.filterActionSucceeded += 1;
        }
      }
      if (row.level === 'warn' && /^Action (click|type)\(.*\) skipped:/i.test(message)) {
        const searchMatched = /(search|검색|query|akcsearch)/i.test(message);
        const filterMatched = /(filter|필터|가격|price|budget|색상|color|red|레드|빨강)/i.test(message);
        if (searchMatched) {
          signal.searchActionSkipped += 1;
        }
        if (filterMatched && !searchMatched) {
          signal.filterActionSkipped += 1;
        }
      }
    }
    return signal;
  }

  private async captureRuntimeScreenshot(
    state: SessionRuntimeState,
    driver: ChatPlaywrightDriver | undefined,
    label: string
  ): Promise<void> {
    if (!driver) {
      return;
    }
    try {
      const path = await driver.capture(label);
      if (!path) {
        return;
      }
      this.recordScreenshot(state, {
        path,
        source: 'runtime',
        capturedAt: nowIso(),
        label
      });
      this.log(state, 'info', `Runtime screenshot captured: ${path}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log(state, 'warn', `Runtime screenshot failed (${label}): ${message}`);
    }
  }

  private classifyStepScreenshotReason(
    step: RuntimeStep,
    stepLogs: ChatAutomationLogEntry[]
  ): 'success' | 'issue' | undefined {
    if (stepLogs.length === 0) {
      return undefined;
    }

    const hasTerminalIssue = stepLogs.some(
      (entry) =>
        entry.level === 'error' ||
        /(failed|dead-end|timeout|captcha|handoff|low-confidence|run failed|unhandled)/i.test(entry.message)
    );
    if (hasTerminalIssue) {
      return 'issue';
    }

    const hasWarning = stepLogs.some((entry) => entry.level === 'warn');

    const hasSuccess = stepLogs.some((entry) => {
      if (entry.level !== 'info') {
        return false;
      }
      return (
        /^Action navigate:/i.test(entry.message) ||
        /^Action (navigate|click|type)\(/i.test(entry.message) ||
        /^Hint navigation hop \d+\/\d+:/i.test(entry.message) ||
        /^Hint navigation traversal completed:/i.test(entry.message) ||
        /^Hint navigation ".*" via (click|navigate):/i.test(entry.message) ||
        /^Summary extracted/i.test(entry.message) ||
        /^Result validation: valid=true/i.test(entry.message) ||
        /^Stepwise stage advanced:/i.test(entry.message)
      );
    });
    if (hasSuccess) {
      return 'success';
    }

    if (step.kind === 'verify') {
      const hasVerifySignal = stepLogs.some((entry) => /^Result validation:/i.test(entry.message));
      if (hasVerifySignal) {
        return 'success';
      }
    }

    if (hasWarning) {
      return 'issue';
    }

    return undefined;
  }

  private shouldCaptureStepScreenshot(step: RuntimeStep): boolean {
    return step.kind === 'navigate' || step.kind === 'listing' || step.kind === 'verify' || step.kind === 'captcha';
  }

  private sanitizeRawSummaryForLlm(rawSummary: string): {
    text: string;
    truncated: boolean;
    strippedHtmlLikeText: boolean;
  } {
    const raw = rawSummary.trim();
    const stripped = raw.replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    const strippedHtmlLikeText = raw !== stripped;
    const maxChars = 12_000;
    const truncated = stripped.length > maxChars;
    const text = truncated ? `${stripped.slice(0, maxChars)}\n...(truncated)` : stripped;
    return {
      text,
      truncated,
      strippedHtmlLikeText
    };
  }

  private async callSummaryLlm(
    target: SummaryLlmTarget,
    prompt: string,
    state?: SessionRuntimeState,
    options?: { softFail?: boolean; phase?: string; promptTag?: string }
  ): Promise<string> {
    const observationMeta: Record<string, unknown> = {
      provider: target.provider,
      baseUrl: target.baseUrl,
      phase: options?.phase ?? 'unspecified'
    };
    const span = this.telemetry.startSpan(
      'chat_automation.llm_call',
      {
        llm_provider: target.provider,
        llm_model: target.model,
        prompt_length: prompt.length,
        llm_prompt_preview: truncateForTelemetry(prompt, 8_000),
        [LF_ATTR.observationType]: 'GENERATION',
        [LF_ATTR.observationModel]: target.model,
        [LF_ATTR.observationModelCompat]: target.model,
        [LF_ATTR.observationInput]: truncateForTelemetry(prompt),
        [LF_ATTR.observationMetadata]: JSON.stringify(observationMeta),
        [LF_ATTR.observationModelParameters]: JSON.stringify({
          temperature: 0.2
        }),
        'gen_ai.system': target.provider,
        'gen_ai.request.model': target.model,
        llm_prompt_tag: trimOptional(options?.promptTag) ?? 'n/a'
      },
      state?.runSpan?.context
    );
    try {
      if (target.provider === 'gemini') {
        const geminiBase = normalizeGeminiBaseUrl(target.baseUrl);
        if (geminiBase.warning) {
          span.addEvent('gemini_base_url_normalized', {
            warning: geminiBase.warning,
            gemini_base_url: geminiBase.baseUrl
          });
          if (state) {
            this.log(state, 'warn', geminiBase.warning);
          }
        }
        span.setAttribute('llm_base_url', geminiBase.baseUrl);

        const response = await fetch(
          `${geminiBase.baseUrl.replace(/\/+$/, '')}/models/${target.model}:generateContent?key=${encodeURIComponent(target.apiKey)}`,
          {
            method: 'POST',
            headers: {
              'content-type': 'application/json'
            },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: {
                temperature: 0.2
              }
            }),
            signal: AbortSignal.timeout(60_000)
          }
        );
        if (!response.ok) {
          const bodyExcerpt = await readResponseBodySafe(response);
          span.setAttribute('http_status', response.status);
          if (bodyExcerpt.length > 0) {
            span.addEvent('gemini_http_error_body', {
              body_excerpt: bodyExcerpt
            });
          }
          throw new Error(
            `gemini http ${response.status} (model=${target.model}; baseUrl=${geminiBase.baseUrl}; body=${bodyExcerpt || 'n/a'})`
          );
        }
        const payload = (await response.json()) as unknown;
        const text = extractGeminiText(payload);
        if (!text) {
          throw new Error('gemini returned empty text');
        }
        span.setAttribute('response_length', text.length);
        span.setAttribute('llm_response_preview', truncateForTelemetry(text, 8_000));
        span.setAttribute(LF_ATTR.observationOutput, truncateForTelemetry(text));
        span.setAttribute('gen_ai.response.model', target.model);
        const usage = extractGeminiUsageDetails(payload);
        if (usage) {
          span.setAttribute('llm_usage_json', JSON.stringify(usage));
          span.setAttribute(LF_ATTR.observationUsageDetails, JSON.stringify(usage));
          span.setAttribute(LF_ATTR.observationUsageCompat, JSON.stringify(usage));
        }
        span.endSuccess();
        return text;
      }

      const response = await fetch(`${target.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${target.apiKey}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          model: target.model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.2,
          max_tokens: 700
        }),
        signal: AbortSignal.timeout(60_000)
      });
      if (!response.ok) {
        const bodyExcerpt = await readResponseBodySafe(response);
        span.setAttribute('http_status', response.status);
        span.setAttribute('llm_base_url', target.baseUrl);
        if (bodyExcerpt.length > 0) {
          span.addEvent('openai_http_error_body', {
            body_excerpt: bodyExcerpt
          });
        }
        throw new Error(
          `openai http ${response.status} (model=${target.model}; baseUrl=${target.baseUrl}; body=${bodyExcerpt || 'n/a'})`
        );
      }
      const payload = (await response.json()) as unknown;
      const text = extractOpenAiText(payload);
      if (!text) {
        throw new Error('openai returned empty text');
      }
      span.setAttribute('response_length', text.length);
      span.setAttribute('llm_response_preview', truncateForTelemetry(text, 8_000));
      span.setAttribute(LF_ATTR.observationOutput, truncateForTelemetry(text));
      span.setAttribute('gen_ai.response.model', target.model);
      const usage = extractOpenAiUsageDetails(payload);
      if (usage) {
        span.setAttribute('llm_usage_json', JSON.stringify(usage));
        span.setAttribute(LF_ATTR.observationUsageDetails, JSON.stringify(usage));
        span.setAttribute(LF_ATTR.observationUsageCompat, JSON.stringify(usage));
      }
      span.endSuccess();
      return text;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      span.setAttribute(LF_ATTR.observationStatusMessage, truncateForTelemetry(message, 2_000));
      if (options?.softFail) {
        span.setAttribute('soft_fail', true);
        if (options.phase) {
          span.setAttribute('soft_fail_phase', options.phase);
        }
        span.addEvent('llm_soft_failure', {
          error_message: message
        });
        span.endSuccess();
      } else {
        span.endError(error);
      }
      throw error;
    }
  }

  private async rewriteSummaryWithLlm(
    state: SessionRuntimeState,
    taskContent: string,
    rawSummary: string,
    maxItems: number
  ): Promise<string> {
    const sanitized = this.sanitizeRawSummaryForLlm(rawSummary);
    const prompt = CHAT_SUMMARY_FORMATTER_PROMPT_V1.render({
      taskContent,
      rawSummary: sanitized.text,
      maxItems
    });
    this.log(
      state,
      'info',
      `Summary prompt prepared (${promptTag(CHAT_SUMMARY_FORMATTER_PROMPT_V1)}; chars=${sanitized.text.length}; truncated=${sanitized.truncated}; html_stripped=${sanitized.strippedHtmlLikeText})`
    );
    const providers = llmProviderOrder();

    for (const provider of providers) {
      const target = resolveSummaryLlmTarget(provider);
      if (!target) {
        continue;
      }
      try {
        const rewritten = await this.callSummaryLlm(target, prompt, state, {
          softFail: true,
          phase: 'summary_formatter',
          promptTag: promptTag(CHAT_SUMMARY_FORMATTER_PROMPT_V1)
        });
        this.log(
          state,
          'info',
          `Summary post-processed by LLM (${target.provider}:${target.model})`
        );
        return rewritten;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.log(
          state,
          'warn',
          `Summary LLM failed (${target.provider}:${target.model}): ${message}`
        );
      }
    }

    this.log(
      state,
      'warn',
      'Summary LLM post-processing skipped: no available provider/key or all providers failed'
    );
    return rawSummary;
  }

  private recentPlannerLogLines(state: SessionRuntimeState, maxLines = 8): string[] {
    return state.logs
      .slice(Math.max(0, state.logs.length - maxLines))
      .map((entry) => `[${entry.level}] ${entry.message}`);
  }

  private analysisForPlannerPrompt(analysis: TaskAnalysis): string {
    return JSON.stringify({
      taskType: analysis.taskType,
      siteType: analysis.siteType,
      goalSummary: analysis.goalSummary,
      constraintBuckets: analysis.constraintBuckets,
      stagedApproach: analysis.stagedApproach,
      strategyOptions: analysis.strategyOptions,
      recommendedStrategy: analysis.recommendedStrategy,
      strategyRationale: analysis.strategyRationale,
      confidence: analysis.confidence
    });
  }

  private async analyzeTaskWithLlm(
    state: SessionRuntimeState,
    task: ChatAutomationTask,
    intent: TaskIntent
  ): Promise<TaskAnalysis> {
    const fallback = buildRuleTaskAnalysis(task, intent);
    if (this.plannerMode === 'rule_first') {
      return fallback;
    }

    const prompt = CHAT_TASK_ANALYZER_PROMPT_V1.render({
      userMessage: task.content,
      targetUrl: detectSiteFromMessage(task.content),
      browserMode: task.browserMode,
      listingPathHints: intent.listingPathHints,
      requiredKeywords: intent.requiredKeywords,
      searchQuery: intent.searchQuery,
      listingFilterJson: intent.listingFilter ? JSON.stringify(intent.listingFilter) : undefined,
      attachmentNames: task.attachments.map((entry) => entry.name),
      recentLogs: this.recentPlannerLogLines(state)
    });
    this.log(
      state,
      'info',
      `Task analysis prompt prepared (${promptTag(CHAT_TASK_ANALYZER_PROMPT_V1)}; chars=${prompt.length})`
    );

    const providers = llmProviderOrder();
    const tiers = resolveAutomationPlannerTiers();
    for (const tier of tiers) {
      for (const provider of providers) {
        const target = resolvePlannerLlmTarget(provider, tier);
        if (!target) {
          continue;
        }
        try {
          const raw = await this.callSummaryLlm(target, prompt, state, {
            softFail: true,
            phase: 'task_analysis',
            promptTag: promptTag(CHAT_TASK_ANALYZER_PROMPT_V1)
          });
          const parsed = parseTaskAnalysisFromRaw(raw, fallback);
          this.log(
            state,
            'info',
            `Task analysis resolved by LLM (${tier}; ${target.provider}:${target.model}; strategy=${parsed.recommendedStrategy ?? 'n/a'} confidence=${parsed.confidence.toFixed(2)})`
          );
          return {
            ...parsed,
            source: 'llm',
            tier,
            provider: target.provider,
            model: target.model
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.log(
            state,
            'warn',
            `Task analysis LLM failed (${tier}; ${target.provider}:${target.model}): ${message}`
          );
        }
      }
    }

    this.log(
      state,
      'warn',
      'Task analysis fallback applied: using rule-based decomposition'
    );
    return fallback;
  }

  private async buildPlannerPlan(
    state: SessionRuntimeState,
    task: ChatAutomationTask,
    intent: TaskIntent,
    analysis: TaskAnalysis
  ): Promise<PlannerPlan> {
    if (this.plannerMode === 'rule_first') {
      return buildRuleFallbackPlannerPlan(intent, analysis.recommendedStrategy);
    }

    const prompt = CHAT_ACTION_PLANNER_PROMPT_V1.render({
      targetUrl: detectSiteFromMessage(task.content),
      browserMode: task.browserMode,
      summaryCount: intent.summaryCount,
      wantsSummary: intent.wantsSummary,
      listingPathHints:
        intent.listingPathHints.length > 0
          ? intent.listingPathHints
          : intent.requiredKeywords.length > 0
            ? intent.requiredKeywords
            : ['메뉴', '카테고리', '상품'],
      hierarchyHintGroups: intent.hierarchyHintGroups,
      requiredKeywords: intent.requiredKeywords,
      searchQuery: intent.searchQuery,
      searchQueryVariants: intent.searchQueryVariants,
      listingFilterJson: intent.listingFilter ? JSON.stringify(intent.listingFilter) : undefined,
      analysisJson: this.analysisForPlannerPrompt(analysis),
      analysisGoalSummary: analysis.goalSummary,
      analysisRecommendedStrategy: analysis.recommendedStrategy,
      attachmentNames: task.attachments.map((entry) => entry.name),
      recentLogs: this.recentPlannerLogLines(state)
    });
    this.log(
      state,
      'info',
      `Planner prompt prepared (${promptTag(CHAT_ACTION_PLANNER_PROMPT_V1)}; chars=${prompt.length})`
    );

    const providers = llmProviderOrder();
    const tiers = resolveAutomationPlannerTiers();
    for (const tier of tiers) {
      for (const provider of providers) {
        const target = resolvePlannerLlmTarget(provider, tier);
        if (!target) {
          continue;
        }

        try {
          const raw = await this.callSummaryLlm(target, prompt, state, {
            softFail: true,
            phase: 'planner',
            promptTag: promptTag(CHAT_ACTION_PLANNER_PROMPT_V1)
          });
          const parsed = parsePlannerActionsFromRaw(raw, intent.summaryCount);
          this.log(
            state,
            'info',
            `Planner resolved by LLM (${tier}; ${target.provider}:${target.model}; actions=${parsed.actions.length})`
          );
          return {
            source: 'llm',
            tier,
            provider: target.provider,
            model: target.model,
            actions: parsed.actions,
            notes: parsed.notes
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.log(
            state,
            'warn',
            `Planner LLM failed (${tier}; ${target.provider}:${target.model}): ${message}`
          );
        }
      }
    }

    this.log(
      state,
      'warn',
      'Planner fallback applied: using rule-based action plan'
    );
    return buildRuleFallbackPlannerPlan(intent, analysis.recommendedStrategy);
  }

  private enforcePlannerPlanDiversity(
    state: SessionRuntimeState,
    plan: PlannerPlan,
    intent: TaskIntent,
    analysis: TaskAnalysis,
    attempt: number
  ): PlannerPlan {
    let actions = [...plan.actions];
    const recommended = analysis.recommendedStrategy?.toLowerCase();
    const searchFallbackStartAttempt = resolveSearchFallbackStartAttempt();
    const queryVariant =
      intent.searchQueryVariants[Math.min(intent.searchQueryVariants.length - 1, Math.max(0, attempt - 1))] ??
      intent.searchQuery;
    const hasHintNavigate = actions.some((entry) => entry.kind === 'hint_navigate');
    const hasSearchType = actions.some((entry) => entry.kind === 'type');
    const hasSummarize = actions.some((entry) => entry.kind === 'summarize');
    const hasNavigationAction = actions.some((entry) => entry.kind === 'navigate' || entry.kind === 'click' || entry.kind === 'hint_navigate');
    const hasConstraintProbeSignals =
      hasPlannerSignalToken(actions, /(필터|조건|가격|색상|정렬|filter|sort|price|만원|원 이하|budget)/i) ||
      hasPlannerSignalToken(actions, /(여성|여성의류|여성스포츠의류|등산복|등산|아웃도어|레드|빨강|red)/i);
    const currentHintNavigations = actions
      .filter((entry): entry is Extract<PlannerAction, { kind: 'hint_navigate' }> => entry.kind === 'hint_navigate')
      .map((entry) => entry.hints.map((hint) => hint.toLowerCase()));
    const hierarchyGroups = intent.hierarchyHintGroups
      .map((group) => uniqueStringList(group, 6))
      .filter((group) => group.length > 0)
      .filter((group) => shouldAllowNavigationRootHints(intent) || !isNavigationRootOnlyGroup(group));
    const isGroupCovered = (group: string[]): boolean => {
      const lowered = group.map((row) => row.toLowerCase());
      return currentHintNavigations.some((existing) =>
        lowered.filter((keyword) =>
          existing.some((token) => token.includes(keyword) || keyword.includes(token))
        ).length >= Math.max(1, Math.ceil(Math.min(lowered.length, 4) / 2))
      );
    };
    const prependHints: Extract<PlannerAction, { kind: 'hint_navigate' }>[] = [];

    if (intent.wantsListingNavigation && !hasNavigationAction) {
      const fallbackNavigationHints =
        hierarchyGroups[0]?.slice(0, 6) ??
        (intent.listingPathHints.length > 0
          ? intent.listingPathHints.slice(0, 6)
          : intent.requiredKeywords.slice(0, 4));
      if (fallbackNavigationHints.length > 0) {
        prependHints.push({
          kind: 'hint_navigate',
          hints: fallbackNavigationHints,
          sortPriceAsc: intent.sortPriceAsc,
          reason: 'auto_added_navigation_strategy'
        });
        this.log(state, 'warn', 'Planner diversity fix: navigation strategy auto-added');
      }
    }

    if (intent.wantsListingNavigation && hierarchyGroups.length > 0) {
      const expectedGroups = attempt >= 2 ? hierarchyGroups.slice(0, 3) : hierarchyGroups.slice(0, 2);
      expectedGroups.forEach((group, index) => {
        if (isGroupCovered(group)) {
          return;
        }
        prependHints.push({
          kind: 'hint_navigate',
          hints: group.slice(0, 6),
          sortPriceAsc: false,
          reason: `auto_added_hierarchy_group_${index + 1}`
        });
        this.log(
          state,
          'warn',
          `Planner diversity fix: hierarchy group auto-added (level=${index + 1}; hints=${group.join(', ')})`
        );
      });
    }

    if (prependHints.length > 0) {
      prependHints
        .slice()
        .reverse()
        .forEach((hintAction) => {
          actions.unshift(hintAction);
        });
    }

    if (intent.wantsListingNavigation && attempt === 1 && hierarchyGroups.length > 0) {
      const deterministicHierarchy = hierarchyGroups.slice(0, 3).map((group, index, list) => ({
        kind: 'hint_navigate' as const,
        hints: group.slice(0, 6),
        sortPriceAsc: index === list.length - 1 ? intent.sortPriceAsc : false,
        reason: 'deterministic_hierarchy_probe'
      }));
      deterministicHierarchy
        .slice()
        .reverse()
        .forEach((action) => {
          actions.unshift(action);
        });
      this.log(
        state,
        'info',
        `Planner diversity: deterministic hierarchy probes prepended (levels=${deterministicHierarchy.length})`
      );
    }

    const hardMenuTraversalRequired =
      shouldForceMenuFirstForAttempt(intent) ||
      intent.explicitCategoryNavigation ||
      intent.hierarchyHintGroups.length >= 2;
    if (
      intent.wantsListingNavigation &&
      attempt === 1 &&
      recommended === 'search_first' &&
      !hasSearchType &&
      !hardMenuTraversalRequired
    ) {
      actions.unshift(
        {
          kind: 'click',
          textHints: ['검색', 'search', '상품검색'],
          label: 'search-box-focus',
          reason: 'analysis_recommended_search_first'
        },
        {
          kind: 'type',
          textHints: ['검색', 'search', '상품검색'],
          value: queryVariant,
          submit: true,
          label: 'search-query-submit',
          reason: 'analysis_recommended_search_first'
        },
        {
          kind: 'wait',
          ms: 900,
          reason: 'analysis_recommended_search_first'
        }
      );
      this.log(state, 'info', `Planner strategy aligned to analysis: search_first (query=\"${queryVariant}\")`);
    }

    if (intent.wantsListingNavigation && attempt >= searchFallbackStartAttempt && !hasSearchType) {
      actions.push({
        kind: 'click',
        textHints: ['검색', 'search', '상품검색'],
        label: 'search-box-focus',
        reason: 'auto_added_search_strategy'
      });
      actions.push({
        kind: 'type',
        textHints: ['검색', 'search', '상품검색'],
        value: queryVariant,
        submit: true,
        label: 'search-query-submit',
        reason: 'auto_added_search_strategy'
      });
      actions.push({
        kind: 'wait',
        ms: 1000,
        reason: 'auto_added_search_strategy'
      });
      this.log(state, 'warn', `Planner diversity fix: in-site search strategy auto-added (query="${queryVariant}")`);
    }

    if (intent.wantsListingNavigation && attempt >= 2 && !hasHintNavigate) {
      const fallbackHints =
        hierarchyGroups[0]?.slice(0, 6) ??
        (intent.listingPathHints.length > 0
          ? intent.listingPathHints.slice(0, 6)
          : intent.explicitCategoryNavigation
            ? ['카테고리', '메뉴', '상품']
            : intent.requiredKeywords.slice(0, 4));
      if (fallbackHints.length > 0) {
        actions.unshift({
          kind: 'hint_navigate',
          hints: fallbackHints,
          sortPriceAsc: intent.sortPriceAsc,
          reason: 'auto_added_menu_strategy'
        });
        this.log(state, 'warn', 'Planner diversity fix: menu/category strategy auto-added');
      }
    }

    if (intent.wantsListingNavigation && intent.listingFilter && attempt === 1) {
      const deterministicProbeActions: PlannerAction[] = [];
      appendConstraintProbeActions(deterministicProbeActions, intent, 'deterministic_constraint_probe');
      if (deterministicProbeActions.length > 0) {
        const summarizeIndex = actions.findIndex((entry) => entry.kind === 'summarize');
        const insertAt = summarizeIndex >= 0 ? summarizeIndex : actions.length;
        actions.splice(insertAt, 0, ...deterministicProbeActions);
        this.log(
          state,
          'info',
          `Planner diversity: deterministic constraint probes inserted before summarize (count=${deterministicProbeActions.length})`
        );
      }
    }

    if (intent.wantsListingNavigation && intent.listingFilter && (!hasConstraintProbeSignals || attempt >= 2)) {
      const before = actions.length;
      appendConstraintProbeActions(actions, intent, `auto_added_constraint_probe_attempt_${attempt}`);
      if (actions.length > before) {
        this.log(
          state,
          'info',
          `Planner diversity: constraint probe actions appended (attempt=${attempt}; added=${actions.length - before})`
        );
      }
    }

    if (intent.wantsListingNavigation && attempt >= 3) {
      const targetUrl = state.run.lastMessage ? detectSiteFromMessage(state.run.lastMessage) : undefined;
      const hasExplicitNavigate = actions.some((entry) => entry.kind === 'navigate');
      if (!hasExplicitNavigate && targetUrl) {
        actions.unshift({
          kind: 'navigate',
          url: targetUrl,
          reason: `strategy_cycle_reset_attempt_${attempt}`
        });
        this.log(
          state,
          'warn',
          `Planner diversity fix: cycle reset navigate added for deep retry (attempt=${attempt})`
        );
      }
    }

    if (intent.wantsSummary && !hasSummarize) {
      actions.push({
        kind: 'summarize',
        maxItems: intent.summaryCount,
        reason: 'auto_added_summary_step'
      });
      this.log(state, 'warn', 'Planner diversity fix: summarize action auto-added');
    }

    if (shouldForceMenuFirstForAttempt(intent)) {
      const summarize = actions.filter((entry) => entry.kind === 'summarize');
      const nonSummarize = actions.filter((entry) => entry.kind !== 'summarize');
      const menu: PlannerAction[] = [];
      const filter: PlannerAction[] = [];
      const search: PlannerAction[] = [];
      const rest: PlannerAction[] = [];
      for (const action of nonSummarize) {
        if (action.kind === 'hint_navigate') {
          menu.push(action);
          continue;
        }
        if (isSearchPlannerAction(action)) {
          search.push(action);
          continue;
        }
        if (isFilterPlannerAction(action)) {
          filter.push(action);
          continue;
        }
        rest.push(action);
      }

      const ordered = [...menu, ...filter, ...rest];
      if (attempt >= searchFallbackStartAttempt) {
        ordered.push(...search);
      } else if (search.length > 0) {
        this.log(
          state,
          'warn',
          `Planner diversity: search fallback actions deferred until attempt>=${searchFallbackStartAttempt} (deferred=${search.length})`
        );
      }
      actions = [...ordered, ...summarize];
    }

    return {
      ...plan,
      actions: actions.slice(0, resolvePlannerMaxActions())
    };
  }

  private validateResultRuleBased(intent: TaskIntent, summary: string): ResultValidation {
    const text = summary.toLowerCase();
    const candidateNames = summary
      .split('\n')
      .map((row) => row.trim())
      .filter((row) => /^\d+\.\s+/.test(row))
      .map((row) => row.replace(/^\d+\.\s+/, '').trim())
      .filter((row) => row.length > 0);
    const candidateText = candidateNames.join(' ').toLowerCase();
    const scopeText = candidateText.length > 0 ? candidateText : text;
    const missing: string[] = [];
    const fail = (constraint: string): void => {
      if (!missing.includes(constraint)) {
        missing.push(constraint);
      }
    };

    let expectationIncludeMatched = false;
    if (intent.resultExpectation) {
      expectationIncludeMatched = intent.resultExpectation.includeAny.some((token) =>
        scopeText.includes(token.toLowerCase())
      );
      const avoidMatched = intent.resultExpectation.avoidAny.some((token) =>
        scopeText.includes(token.toLowerCase())
      );
      if (!expectationIncludeMatched) {
        fail(`expectedCategory:${intent.resultExpectation.label}`);
      }
      if (avoidMatched && !expectationIncludeMatched) {
        fail(`categoryMismatch:${intent.resultExpectation.label}`);
      }
    }

    if (intent.listingFilter?.requireWomenWear && !/(여성|women|woman|lady)/i.test(scopeText)) {
      fail('requireWomenWear');
    }
    if (intent.listingFilter?.requireHikingWear && !/(등산복|hiking|아웃도어|트레킹|mountain|등산)/i.test(scopeText)) {
      fail('requireHikingWear');
    }
    if (intent.listingFilter?.requireRedColor) {
      const hasTextRed = /(레드|빨강|붉|red)/i.test(scopeText);
      const visualScores = Array.from(summary.matchAll(/visual rank \d+: .*?red=(\d+(?:\.\d+)?)/gi))
        .map((match) => Number(match[1]))
        .filter((value) => Number.isFinite(value));
      const hasVisualRed = visualScores.some((score) => score >= 0.06);
      if (!hasTextRed && !hasVisualRed) {
        fail('requireRedColor');
      }
    }
    if (intent.requiredKeywords.length > 0) {
      const keywordMatched = intent.requiredKeywords.some((keyword) => {
        const signals = expandKeywordSignals(keyword);
        return signals.some((signal) => scopeText.includes(signal));
      });
      if (!keywordMatched) {
        if (!expectationIncludeMatched) {
          fail(`requiredKeyword:${intent.requiredKeywords.join('|')}`);
        }
      }
    }

    if (
      typeof intent.listingFilter?.maxLumpSum === 'number' &&
      Number.isFinite(intent.listingFilter.maxLumpSum) &&
      intent.listingFilter.maxLumpSum > 0
    ) {
      const wonMatches = summary.match(/\d[\d,]{2,}\s*원/g) ?? [];
      let hasAffordable = false;
      for (const rawPrice of wonMatches) {
        const numberRaw = rawPrice.match(/\d[\d,]*/)?.[0];
        if (!numberRaw) {
          continue;
        }
        const numeric = Number(numberRaw.replace(/,/g, ''));
        if (Number.isFinite(numeric) && numeric <= intent.listingFilter.maxLumpSum) {
          hasAffordable = true;
          break;
        }
      }
      if (!hasAffordable) {
        fail(`maxLumpSum:${intent.listingFilter.maxLumpSum}`);
      }
    }

    return {
      valid: missing.length === 0,
      confidence: missing.length === 0 ? 0.72 : 0.38,
      reason: missing.length === 0 ? 'rule_validation_passed' : 'rule_validation_failed',
      missingConstraints: missing,
      retryHints: missing.length === 0 ? [] : ['메뉴/카테고리 경로 재시도', '사이트 검색창으로 키워드 재검색'],
      source: 'rule'
    };
  }

  private async validateResultWithLlm(
    state: SessionRuntimeState,
    task: ChatAutomationTask,
    intent: TaskIntent,
    summary: string
  ): Promise<ResultValidation> {
    const ruleValidation = this.validateResultRuleBased(intent, summary);
    const constraint = {
      requiredKeywords: intent.requiredKeywords,
      hierarchyHintGroups: intent.hierarchyHintGroups,
      searchQuery: intent.searchQuery,
      resultExpectation: intent.resultExpectation,
      listingFilter: intent.listingFilter,
      wantsSummary: intent.wantsSummary,
      summaryCount: intent.summaryCount
    };
    const prompt = CHAT_RESULT_VALIDATOR_PROMPT_V1.render({
      userMessage: task.content,
      extractedSummary: summary,
      constraintJson: JSON.stringify(constraint)
    });
    this.log(
      state,
      'info',
      `Result validation prompt prepared (${promptTag(CHAT_RESULT_VALIDATOR_PROMPT_V1)}; chars=${prompt.length})`
    );

    const providers = llmProviderOrder();
    const tiers = resolveAutomationPlannerTiers();
    for (const tier of tiers) {
      for (const provider of providers) {
        const target = resolvePlannerLlmTarget(provider, tier);
        if (!target) {
          continue;
        }
        try {
          const raw = await this.callSummaryLlm(target, prompt, state, {
            softFail: true,
            phase: 'result_validator',
            promptTag: promptTag(CHAT_RESULT_VALIDATOR_PROMPT_V1)
          });
          const parsed = parseResultValidationFromRaw(raw);
          return {
            ...parsed,
            source: 'llm',
            tier,
            provider: target.provider,
            model: target.model
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.log(
            state,
            'warn',
            `Result validation LLM failed (${tier}; ${target.provider}:${target.model}): ${message}`
          );
        }
      }
    }

    this.log(
      state,
      'warn',
      `Result validation fallback: rule-based (${ruleValidation.reason}; missing=${ruleValidation.missingConstraints.join(',') || 'none'})`
    );
    return ruleValidation;
  }

  private async requestHandoffAndWait(
    sessionId: string,
    state: SessionRuntimeState,
    task: ChatAutomationTask,
    input: {
      type: ChatAutomationHandoffType;
      prompt: string;
      assistantMessage: string;
      acceptedLogLabel: string;
    }
  ): Promise<void> {
    state.handoffs.push({
      id: `${task.id}-handoff-${state.handoffs.length + 1}`,
      type: input.type,
      status: 'waiting',
      prompt: input.prompt,
      requestedAt: nowIso()
    });

    state.run.status = state.paused ? 'paused' : 'waiting_captcha';
    state.run.waitingCaptcha = true;
    state.run.captchaPrompt = input.prompt;
    this.log(state, 'warn', `${input.type} input required from user`);
    await this.appendTurn(sessionId, {
      role: 'assistant',
      content: input.assistantMessage
    });
    await this.emitSnapshot(sessionId);

    while (!state.pendingCaptchaValue) {
      if (state.canceled || state.run.runId !== task.id) {
        throw new Error('run canceled');
      }
      state.run.status = state.paused ? 'paused' : 'waiting_captcha';
      await sleep(150);
    }

    const submitted = state.pendingCaptchaValue;
    state.pendingCaptchaValue = undefined;
    state.run.waitingCaptcha = false;
    state.run.captchaPrompt = undefined;
    state.run.status = state.paused ? 'paused' : 'running';

    const waiting = [...state.handoffs]
      .reverse()
      .find((entry) => entry.type === input.type && entry.status === 'waiting');
    if (waiting) {
      waiting.status = 'resolved';
      waiting.resolvedAt = nowIso();
      waiting.valueLength = submitted.length;
    }

    this.log(state, 'info', `${input.acceptedLogLabel} (length=${submitted.length})`);
    const handoffLabel = input.type === 'captcha' ? 'Captcha' : 'Security challenge';
    await this.appendTurn(sessionId, {
      role: 'assistant',
      content: `${handoffLabel} value received. Continuing automation.`
    });
    await this.emitSnapshot(sessionId);
  }

  private isSearchOrFilterAction(label: string | undefined, hints: string[]): boolean {
    const joined = `${label ?? ''} ${hints.join(' ')}`.toLowerCase();
    return /(search|query|검색|상품검색|filter|sort|정렬|필터|가격|색상|조건)/i.test(joined);
  }

  private buildActionObjective(
    intent: TaskIntent,
    rawHints: string[] | undefined,
    actionKind: 'hint_navigate' | 'click',
    label?: string
  ): ActionObjective | undefined {
    if (!intent.wantsListingNavigation) {
      return undefined;
    }

    const hints = (rawHints ?? [])
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
    const actionSignal = `${label ?? ''} ${hints.join(' ')}`.toLowerCase();
    const isSearchOnlyAction = /(search|query|검색|상품검색|찾기)/i.test(actionSignal);
    if (actionKind === 'click' && isSearchOnlyAction) {
      return undefined;
    }

    const include: string[] = [];
    const seenInclude = new Set<string>();
    const pushInclude = (token: string): void => {
      const cleaned = token.trim().toLowerCase();
      if (!cleaned || cleaned.length < 2 || seenInclude.has(cleaned) || isGenericNavigationHint(cleaned)) {
        return;
      }
      seenInclude.add(cleaned);
      include.push(cleaned);
    };

    const avoid: string[] = [];
    const seenAvoid = new Set<string>();
    const pushAvoid = (token: string): void => {
      const cleaned = token.trim().toLowerCase();
      if (!cleaned || cleaned.length < 2 || seenAvoid.has(cleaned)) {
        return;
      }
      seenAvoid.add(cleaned);
      avoid.push(cleaned);
    };

    const rootOnlyHints = hints.length > 0 && hints.every((hint) => isGenericNavigationHint(hint));
    const navigationNoiseTokens = [
      'ai',
      '뉴스',
      'news',
      '블로그',
      'blog',
      '리뷰',
      'review',
      '가이드',
      'guide',
      '이벤트',
      'event',
      '프로모션',
      'promotion',
      '공지',
      'notice',
      '도움말',
      'help',
      'faq'
    ];

    if (rootOnlyHints && actionKind === 'hint_navigate') {
      for (const hint of hints) {
        pushInclude(hint);
      }
      pushInclude('카테고리');
      pushInclude('메뉴');
      pushInclude('category');
      pushInclude('menu');
      for (const token of navigationNoiseTokens) {
        pushAvoid(token);
      }
    } else {
      for (const hint of hints) {
        pushInclude(hint);
      }
      for (const keyword of intent.requiredKeywords.slice(0, 4)) {
        const signals = expandKeywordSignals(keyword);
        for (const signal of signals.slice(0, 3)) {
          pushInclude(signal);
        }
      }
      for (const token of intent.resultExpectation?.includeAny ?? []) {
        pushInclude(token);
      }
      if (intent.listingFilter?.requireWomenWear) {
        pushInclude('여성');
        pushInclude('women');
        pushAvoid('남성');
      }
      if (intent.listingFilter?.requireHikingWear) {
        pushInclude('등산');
        pushInclude('아웃도어');
        pushInclude('hiking');
      }
      if (intent.listingFilter?.requireRedColor) {
        pushInclude('레드');
        pushInclude('빨강');
        pushInclude('red');
      }
      for (const token of intent.resultExpectation?.avoidAny ?? []) {
        pushAvoid(token);
      }
      if (actionKind === 'hint_navigate') {
        for (const token of navigationNoiseTokens) {
          pushAvoid(token);
        }
        if (intent.resultExpectation?.label === 'apparel_expected') {
          for (const token of [
            '등산화',
            '트레킹화',
            '신발',
            '슈즈',
            'footwear',
            'shoe',
            'shoes',
            '등산스틱',
            '스틱',
            '등산장비',
            '장비'
          ]) {
            pushAvoid(token);
          }
        }
        if (intent.listingFilter?.requireWomenWear || intent.listingFilter?.requireHikingWear) {
          for (const token of [
            '자동차',
            '차량',
            'auto',
            'car',
            '가전',
            '디지털',
            '컴퓨터',
            '노트북',
            'tv',
            '생활가전',
            '식품',
            '주방',
            '문구',
            '도서',
            '유아',
            '출산',
            '가구',
            '인테리어'
          ]) {
            pushAvoid(token);
          }
        }
      }
    }

    for (const token of intent.resultExpectation?.avoidAny ?? []) {
      pushAvoid(token);
    }

    const strictHintNavigate = actionKind === 'hint_navigate' && !rootOnlyHints && include.length > 0;
    const strictRootHintNavigate = actionKind === 'hint_navigate' && rootOnlyHints;
    const strictCategoryClick =
      actionKind === 'click' &&
      !this.isSearchOrFilterAction(label, hints) &&
      include.length > 0;
    const includeAny = include.slice(0, 14);
    const avoidAny = avoid.slice(0, 24);

    if (includeAny.length === 0 && avoidAny.length === 0) {
      return undefined;
    }
    return {
      includeAny,
      avoidAny,
      strict: strictRootHintNavigate || strictHintNavigate || strictCategoryClick
    };
  }

  private async executePlannerAction(
    sessionId: string,
    state: SessionRuntimeState,
    task: ChatAutomationTask,
    action: PlannerAction,
    intent: TaskIntent,
    driver: ChatPlaywrightDriver | undefined,
    listingSummaryOptions: ReturnType<typeof buildListingPageSummaryOptions>,
    defaultSummaryCount: number
  ): Promise<PlannerActionExecutionSignal> {
    const emptySignal = (): PlannerActionExecutionSignal => ({
      hintNavigateSuccess: 0,
      hintNavigateSkipped: 0,
      searchActionSucceeded: 0,
      searchActionSkipped: 0,
      filterActionSucceeded: 0,
      filterActionSkipped: 0,
      budgetFilterSucceeded: 0,
      colorFilterSucceeded: 0
    });
    let spanClosed = false;
    const actionSpan = this.telemetry.startSpan(
      'chat_automation.planner_action',
      {
        action_kind: action.kind,
        action_reason: action.reason ?? 'n/a',
        browser_active: Boolean(driver)
      },
      state.runSpan?.context
    );
    try {
      switch (action.kind) {
        case 'navigate': {
          if (driver) {
            this.logDriverMessages(state, await driver.navigate(action.url));
          } else {
            this.log(state, 'info', `Simulated action navigate: ${action.url}`);
          }
          return emptySignal();
        }
        case 'hint_navigate': {
          const optimizedHints = optimizeHintNavigateHints(action.hints, intent);
          const optimizedAction: Extract<PlannerAction, { kind: 'hint_navigate' }> = {
            ...action,
            hints: optimizedHints
          };
          const maxPathSteps = resolveHintNavigateMaxPathSteps(intent, optimizedAction);
          if (driver) {
            if (optimizedHints.join('||') !== action.hints.join('||')) {
              this.log(
                state,
                'info',
                `Hint navigate hints optimized: raw=[${action.hints.join(', ')}] -> effective=[${optimizedHints.join(', ')}]`
              );
            }
            const objective = this.buildActionObjective(intent, optimizedHints, action.kind);
            const signal = this.logDriverMessages(
              state,
              await driver.navigateListingByHints({
                pathHints: optimizedHints,
                sortPriceAsc: action.sortPriceAsc,
                objective,
                maxPathSteps
              })
            );
            this.log(
              state,
              'info',
              `Hint navigate dispatch: maxPathSteps=${maxPathSteps} hints=${optimizedHints.join(', ')}`
            );
            return {
              ...emptySignal(),
              hintNavigateSuccess: signal.hintNavigateSuccess,
              hintNavigateSkipped: signal.hintNavigateSkipped
            };
          } else {
            this.log(
              state,
              'info',
              `Simulated action hint_navigate: hints=${action.hints.join(', ')} sortPriceAsc=${Boolean(action.sortPriceAsc)} maxPathSteps=${maxPathSteps}`
            );
            return emptySignal();
          }
        }
        case 'click': {
          if (driver) {
            const objective = this.buildActionObjective(intent, action.textHints, action.kind, action.label);
            const signal = this.logDriverMessages(
              state,
              await driver.clickByHints({
                selectors: action.selectors,
                textHints: action.textHints,
                label: action.label,
                objective
              })
            );
            const searchAction = isSearchPlannerAction(action);
            const filterAction = isFilterPlannerAction(action);
            const budgetFilterAction = filterAction && !searchAction && isBudgetFilterPlannerAction(action);
            const colorFilterAction = filterAction && !searchAction && isColorFilterPlannerAction(action);
            const currentUrl = driver.currentUrl();
            const filterContextUrlOk = currentUrl ? isListingOrSearchLikeUrl(currentUrl) : false;
            return {
              ...emptySignal(),
              searchActionSucceeded: searchAction ? signal.searchActionSucceeded : 0,
              searchActionSkipped: searchAction ? signal.searchActionSkipped : 0,
              filterActionSucceeded: filterAction ? signal.filterActionSucceeded : 0,
              filterActionSkipped: filterAction ? signal.filterActionSkipped : 0,
              budgetFilterSucceeded:
                budgetFilterAction && filterContextUrlOk ? signal.filterActionSucceeded : 0,
              colorFilterSucceeded:
                colorFilterAction && filterContextUrlOk ? signal.filterActionSucceeded : 0
            };
          } else {
            this.log(
              state,
              'info',
              `Simulated action click: selectors=${(action.selectors ?? []).join(' || ') || 'n/a'} hints=${(action.textHints ?? []).join(', ') || 'n/a'}`
            );
            return emptySignal();
          }
        }
        case 'type': {
          if (driver) {
            const searchAction = isSearchPlannerAction(action);
            const filterAction = isFilterPlannerAction(action);
            const effectiveSubmit =
              filterAction && !searchAction ? false : action.submit;
            if (filterAction && !searchAction && action.submit) {
              this.log(
                state,
                'info',
                `Type action submit suppressed for filter context: label=${action.label ?? 'n/a'}`
              );
            }
            const signal = this.logDriverMessages(
              state,
              await driver.typeByHints({
                selectors: action.selectors,
                textHints: action.textHints,
                value: action.value,
                submit: effectiveSubmit,
                label: action.label,
                intent: filterAction && !searchAction ? 'filter' : 'search',
                allowBudgetFallback: filterAction && !searchAction
              })
            );
            const budgetFilterAction = filterAction && !searchAction && isBudgetFilterPlannerAction(action);
            const colorFilterAction = filterAction && !searchAction && isColorFilterPlannerAction(action);
            const currentUrl = driver.currentUrl();
            const filterContextUrlOk = currentUrl ? isListingOrSearchLikeUrl(currentUrl) : false;
            return {
              ...emptySignal(),
              searchActionSucceeded: searchAction ? signal.searchActionSucceeded : 0,
              searchActionSkipped: searchAction ? signal.searchActionSkipped : 0,
              filterActionSucceeded: filterAction ? signal.filterActionSucceeded : 0,
              filterActionSkipped: filterAction ? signal.filterActionSkipped : 0,
              budgetFilterSucceeded:
                budgetFilterAction && filterContextUrlOk ? signal.filterActionSucceeded : 0,
              colorFilterSucceeded:
                colorFilterAction && filterContextUrlOk ? signal.filterActionSucceeded : 0
            };
          } else {
            this.log(
              state,
              'info',
              `Simulated action type: chars=${action.value.length} submit=${Boolean(action.submit)}`
            );
            return emptySignal();
          }
        }
        case 'wait': {
          if (driver) {
            this.logDriverMessages(state, await driver.waitForMilliseconds(action.ms));
          } else {
            await sleep(action.ms);
            this.log(state, 'info', `Simulated action wait: ${action.ms}ms`);
          }
          return emptySignal();
        }
        case 'summarize': {
          const maxItems = action.maxItems ?? defaultSummaryCount;
          if (driver) {
            state.latestSummary = await driver.summarizeCurrentPage(maxItems, listingSummaryOptions);
            this.log(state, 'info', `Summary extracted from current page (max=${maxItems})`);
            this.log(state, 'info', `Summary preview: ${summaryPreview(state.latestSummary)}`);
          } else {
            this.log(
              state,
              'info',
              `Simulated action summarize (max=${maxItems}) skipped because browser executor is not active`
            );
          }
          return emptySignal();
        }
        case 'handoff': {
          await this.requestHandoffAndWait(sessionId, state, task, {
            type: action.handoffType,
            prompt: action.prompt,
            assistantMessage: `${action.handoffType} detected. Please provide manual input to continue safely.`,
            acceptedLogLabel: `${action.handoffType} accepted`
          });
          return emptySignal();
        }
        case 'noop': {
          this.log(state, 'info', `Planner noop: ${action.reason ?? 'n/a'}`);
          return emptySignal();
        }
        default: {
          this.log(state, 'warn', 'Planner action skipped: unsupported action kind');
          return emptySignal();
        }
      }
    } catch (error) {
      actionSpan.endError(error);
      spanClosed = true;
      throw error;
    } finally {
      if (!spanClosed) {
        actionSpan.endSuccess();
      }
    }
  }

  private async executeStep(
    sessionId: string,
    state: SessionRuntimeState,
    step: RuntimeStep,
    task: ChatAutomationTask,
    stepIndex: number,
    totalSteps: number,
    intent: TaskIntent,
    analysis: TaskAnalysis,
    driver?: ChatPlaywrightDriver
  ): Promise<void> {
    await this.waitWhilePaused(state);
    if (state.canceled || state.run.runId !== task.id) {
      throw new Error('run canceled');
    }
    const stepSpan = this.telemetry.startSpan(
      'chat_automation.step',
      {
        step_kind: step.kind,
        step_index: stepIndex + 1,
        step_total: totalSteps
      },
      state.runSpan?.context
    );

    try {
      state.run.step = stepIndex + 1;
      state.run.totalSteps = totalSteps;
      state.run.currentStepTitle = step.title;
      state.run.updatedAt = nowIso();

      this.log(state, 'info', `Step ${stepIndex + 1}/${totalSteps}: ${step.title}`);
      await this.emitSnapshot(sessionId);
      const stepLogStartIndex = state.logs.length;

      if (step.kind === 'captcha') {
        await this.requestHandoffAndWait(sessionId, state, task, {
          type: 'captcha',
          prompt: 'Security challenge detected. Enter captcha value to continue.',
          assistantMessage: 'Captcha/security challenge detected. Please enter captcha in UI to continue safely.',
          acceptedLogLabel: 'Captcha accepted'
        });
        await sleep(this.stepDelayMs);
        return;
      }

      const listingSummaryOptions = buildListingPageSummaryOptions(intent);

      if (step.kind === 'browser') {
        this.log(state, 'info', 'Browser runtime is ready for deterministic actions');
      } else if (step.kind === 'navigate') {
        const target = detectSiteFromMessage(task.content);
        if (driver) {
          this.logDriverMessages(state, await driver.navigate(target));
        } else {
          this.log(state, 'info', `Simulated action navigate: ${target}`);
        }
      } else if (step.kind === 'listing') {
        const maxAttempts = resolvePlannerMaxAttempts();
        const searchFallbackStartAttempt = resolveSearchFallbackStartAttempt();
        const minHintSignalsForContext = resolveCategoryContextMinHintSignals();
        let listingValidated = !intent.wantsSummary || !driver;
        let menuFirstEnforced = shouldForceMenuFirstForAttempt(intent);
        let categoryContextCarryOver = false;
        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
          this.log(state, 'info', `Listing strategy attempt ${attempt}/${maxAttempts}`);
          const targetSiteUrl = detectSiteFromMessage(task.content);
          const rawPlan = await this.buildPlannerPlan(state, task, intent, analysis);
          const plan = this.enforcePlannerPlanDiversity(state, rawPlan, intent, analysis, attempt);
          const seenHintTokens = new Set<string>();
          let hintDeadEndStreak = 0;
          let skipRemainingHintActions = false;
          let abortAttemptDueToHierarchyDeadEnd = false;
          const attemptSignal: PlannerActionExecutionSignal = {
            hintNavigateSuccess: 0,
            hintNavigateSkipped: 0,
            searchActionSucceeded: 0,
            searchActionSkipped: 0,
            filterActionSucceeded: 0,
            filterActionSkipped: 0,
            budgetFilterSucceeded: 0,
            colorFilterSucceeded: 0
          };
          this.log(
            state,
            'info',
            `Planner selected ${plan.actions.length} action(s) source=${plan.source}${plan.tier ? ` tier=${plan.tier}` : ''}${plan.provider ? ` provider=${plan.provider}` : ''}${plan.model ? ` model=${plan.model}` : ''}`
          );
          if (plan.notes) {
            this.log(state, 'info', `Planner notes: ${plan.notes}`);
          }
          let stepwiseRootReady = !menuFirstEnforced || categoryContextCarryOver;
          let stepwiseCategoryReady = !menuFirstEnforced || categoryContextCarryOver;
          let categoryContextGateOpen = !menuFirstEnforced || categoryContextCarryOver;
          const contextGateActive =
            menuFirstEnforced && attempt < searchFallbackStartAttempt;
          if (menuFirstEnforced && categoryContextCarryOver) {
            this.log(
              state,
              'info',
              `Stepwise context carry-over enabled from previous attempt (attempt=${attempt})`
            );
          }
          if (contextGateActive) {
            this.log(
              state,
              'info',
              `Category context gate active: requires hint_success>=${minHintSignalsForContext} before filter/search actions`
            );
          }
          if (menuFirstEnforced) {
            this.log(
              state,
              'info',
              'Stepwise exploration policy active: stage1(root menu) -> stage2(category traversal) -> stage3(filters) -> stage4(search fallback)'
            );
          }

          for (let index = 0; index < plan.actions.length; index += 1) {
            if (abortAttemptDueToHierarchyDeadEnd) {
              this.log(
                state,
                'warn',
                `Planner action loop aborted early: unresolved hierarchy traversal (attempt=${attempt})`
              );
              break;
            }
            const action = plan.actions[index]!;
            if (skipRemainingHintActions && action.kind === 'hint_navigate') {
              this.log(
                state,
                'warn',
                `Planner action ${index + 1}/${plan.actions.length} skipped by hint dead-end guard`
              );
              await this.emitSnapshot(sessionId);
              continue;
            }
            if (
              driver &&
              intent.wantsListingNavigation &&
              action.kind === 'navigate'
            ) {
              const currentUrl = driver.currentUrl();
              const actionNavigatesToTargetRoot =
                isRootHomepageUrl(action.url) &&
                isRootHomepageUrl(targetSiteUrl) &&
                sameHostFamily(action.url, targetSiteUrl);
              const progressedActions =
                attemptSignal.hintNavigateSuccess +
                  attemptSignal.filterActionSucceeded +
                  attemptSignal.searchActionSucceeded >
                0;
              const midAttemptHomeReset = attempt > 1 || index > 0;
              if (
                actionNavigatesToTargetRoot &&
                (midAttemptHomeReset ||
                  (progressedActions &&
                    isListingOrSearchLikeUrl(currentUrl) &&
                    sameHostFamily(currentUrl, action.url)))
              ) {
                this.log(
                  state,
                  'warn',
                  `Navigate action skipped (home-reset guard): from=${currentUrl ?? 'n/a'} to=${action.url} attempt=${attempt} actionIndex=${index + 1}`
                );
                await this.emitSnapshot(sessionId);
                continue;
              }
            }
            const searchAction = isSearchPlannerAction(action);
            const filterAction =
              (action.kind === 'click' || action.kind === 'type') &&
              isFilterPlannerAction(action);
            const rootHintAction = isRootHintNavigateAction(action);
            const categoryHintAction =
              action.kind === 'hint_navigate' && !rootHintAction;
            if (menuFirstEnforced && categoryHintAction && !stepwiseRootReady) {
              this.log(
                state,
                'warn',
                `Planner action ${index + 1}/${plan.actions.length} skipped by stepwise-stage gate: category traversal is blocked until root menu stage succeeds`
              );
              await this.emitSnapshot(sessionId);
              continue;
            }
            if (menuFirstEnforced && filterAction && !stepwiseCategoryReady) {
              this.log(
                state,
                'warn',
                `Planner action ${index + 1}/${plan.actions.length} skipped by stepwise-stage gate: filter stage is blocked until category traversal succeeds`
              );
              attemptSignal.filterActionSkipped += 1;
              await this.emitSnapshot(sessionId);
              continue;
            }
            if (menuFirstEnforced && searchAction) {
              const missingFilters = missingRequiredListingFilters(intent, attemptSignal);
              if (!stepwiseCategoryReady || missingFilters.length > 0) {
                const reason = !stepwiseCategoryReady ? 'category' : missingFilters.join(',');
                this.log(
                  state,
                  'warn',
                  `Planner action ${index + 1}/${plan.actions.length} skipped by stepwise-stage gate: search stage blocked (missing=${reason})`
                );
                attemptSignal.searchActionSkipped += 1;
                await this.emitSnapshot(sessionId);
                continue;
              }
            }
            if (
              contextGateActive &&
              !categoryContextGateOpen &&
              (searchAction || filterAction)
            ) {
              this.log(
                state,
                'warn',
                `Planner action ${index + 1}/${plan.actions.length} skipped by category-context gate: ${action.kind}${action.reason ? ` (${action.reason})` : ''}`
              );
              if (searchAction) {
                attemptSignal.searchActionSkipped += 1;
              }
              if (filterAction) {
                attemptSignal.filterActionSkipped += 1;
              }
              await this.emitSnapshot(sessionId);
              continue;
            }
            if (
              menuFirstEnforced &&
              filterAction &&
              driver
            ) {
              const currentUrl = driver.currentUrl();
              const stillAtRootHomepage =
                Boolean(currentUrl) &&
                isRootHomepageUrl(currentUrl) &&
                sameHostFamily(currentUrl, targetSiteUrl);
              if (stillAtRootHomepage && !stepwiseCategoryReady) {
                this.log(
                  state,
                  'warn',
                  `Planner action ${index + 1}/${plan.actions.length} skipped by root-filter guard: filter actions are blocked until category/listing page is entered (url=${currentUrl ?? 'n/a'})`
                );
                attemptSignal.filterActionSkipped += 1;
                await this.emitSnapshot(sessionId);
                continue;
              }
            }
            if (
              menuFirstEnforced &&
              intent.listingFilter &&
              searchAction
            ) {
              const missingFilters = missingRequiredListingFilters(intent, attemptSignal);
              const currentUrl = driver?.currentUrl();
              const stillAtRootHomepage =
                Boolean(currentUrl) &&
                isRootHomepageUrl(currentUrl) &&
                sameHostFamily(currentUrl, targetSiteUrl);
              const allowSearchToEscapeRoot =
                stepwiseCategoryReady &&
                stillAtRootHomepage &&
                attempt >= searchFallbackStartAttempt;
              if (missingFilters.length > 0 && !allowSearchToEscapeRoot) {
                this.log(
                  state,
                  'warn',
                  `Planner action ${index + 1}/${plan.actions.length} skipped by filter-first gate: search actions are blocked until required filters are applied (missing=${missingFilters.join(',')})`
                );
                attemptSignal.searchActionSkipped += 1;
                await this.emitSnapshot(sessionId);
                continue;
              }
              if (missingFilters.length > 0 && allowSearchToEscapeRoot) {
                this.log(
                  state,
                  'info',
                  `Filter-first gate relaxed: allowing search action to exit root context before applying filters (missing=${missingFilters.join(',')})`
                );
              }
            }
            if (
              menuFirstEnforced &&
              categoryContextGateOpen &&
              action.kind === 'hint_navigate'
            ) {
              const normalizedHints = collectNormalizedHintTokens(action.hints);
              const hintReuseRatio = calculateHintReuseRatio(normalizedHints, seenHintTokens);
              const hasRootHints = normalizedHints.some((hint) => isGenericNavigationHint(hint));
              const hasFilterOrSearchAhead = plan.actions
                .slice(index + 1)
                .some((nextAction) => isSearchPlannerAction(nextAction) || isFilterPlannerAction(nextAction));
              if (
                hasFilterOrSearchAhead &&
                (hasRootHints ||
                  hintReuseRatio >= 0.5 ||
                  shouldSkipHintNavigateAfterContextOpen(action, intent))
              ) {
                this.log(
                  state,
                  'info',
                  `Hint navigate skipped after context-open stabilization: hints=${action.hints.join(', ')} reuse=${hintReuseRatio.toFixed(2)}`
                );
                await this.emitSnapshot(sessionId);
                continue;
              }
            }
            this.log(
              state,
              'info',
              `Planner action ${index + 1}/${plan.actions.length}: ${action.kind}${action.reason ? ` (${action.reason})` : ''}`
            );
            const actionSignal = await this.executePlannerAction(
              sessionId,
              state,
              task,
              action,
              intent,
              driver,
              listingSummaryOptions,
              intent.summaryCount
            );
            const rootOnlyHintAction =
              action.kind === 'hint_navigate' &&
              action.hints.length > 0 &&
              action.hints.every((hint) => isGenericNavigationHint(hint));
            const strictHintProgress =
              actionSignal.hintNavigateSuccess > 0 &&
              actionSignal.hintNavigateSkipped === 0;
            const hintSuccessToAdd =
              rootOnlyHintAction || !strictHintProgress ? 0 : actionSignal.hintNavigateSuccess;
            if (rootOnlyHintAction && actionSignal.hintNavigateSuccess > 0) {
              this.log(
                state,
                'info',
                `Hint success ignored for context gate (root-only hints): ${action.hints.join(', ')}`
              );
            } else if (!strictHintProgress && actionSignal.hintNavigateSuccess > 0) {
              this.log(
                state,
                'info',
                `Hint success ignored for context gate (partial traversal): success=${actionSignal.hintNavigateSuccess}, skipped=${actionSignal.hintNavigateSkipped}`
              );
            }
            attemptSignal.hintNavigateSuccess += hintSuccessToAdd;
            attemptSignal.hintNavigateSkipped += actionSignal.hintNavigateSkipped;
            attemptSignal.searchActionSucceeded += actionSignal.searchActionSucceeded;
            attemptSignal.searchActionSkipped += actionSignal.searchActionSkipped;
            attemptSignal.filterActionSucceeded += actionSignal.filterActionSucceeded;
            attemptSignal.filterActionSkipped += actionSignal.filterActionSkipped;
            attemptSignal.budgetFilterSucceeded += actionSignal.budgetFilterSucceeded;
            attemptSignal.colorFilterSucceeded += actionSignal.colorFilterSucceeded;
            if (menuFirstEnforced && rootHintAction && actionSignal.hintNavigateSuccess > 0) {
              if (!stepwiseRootReady) {
                stepwiseRootReady = true;
                this.log(
                  state,
                  'info',
                  `Stepwise stage advanced: root menu stage satisfied (attempt=${attempt}, action=${index + 1})`
                );
              }
            }
            if (menuFirstEnforced && categoryHintAction && actionSignal.hintNavigateSuccess > 0) {
              const currentUrl = driver?.currentUrl();
              const stillRoot =
                Boolean(currentUrl) &&
                isRootHomepageUrl(currentUrl) &&
                sameHostFamily(currentUrl, targetSiteUrl);
              const overlayCategoryEvidence =
                stillRoot &&
                actionSignal.hintNavigateSuccess >= 2 &&
                actionSignal.hintNavigateSkipped <= actionSignal.hintNavigateSuccess + 1;
              if ((!stillRoot || overlayCategoryEvidence) && !stepwiseCategoryReady) {
                stepwiseCategoryReady = true;
                categoryContextGateOpen = true;
                categoryContextCarryOver = true;
                this.log(
                  state,
                  'info',
                  !stillRoot
                    ? `Stepwise stage advanced: category traversal stage satisfied (url=${currentUrl ?? 'n/a'})`
                    : `Stepwise stage advanced: category traversal stage satisfied via overlay evidence (same-root URL, hint_success=${actionSignal.hintNavigateSuccess})`
                );
              }
            }
            if (action.kind === 'hint_navigate') {
              for (const hint of collectNormalizedHintTokens(action.hints)) {
                seenHintTokens.add(hint);
              }
              if (actionSignal.hintNavigateSuccess > 0) {
                hintDeadEndStreak = 0;
              } else {
                hintDeadEndStreak += 1;
                if (
                  contextGateActive &&
                  !categoryContextGateOpen &&
                  hintDeadEndStreak >= 2
                ) {
                  skipRemainingHintActions = true;
                  abortAttemptDueToHierarchyDeadEnd = true;
                  this.log(
                    state,
                    'warn',
                    `Hint dead-end guard activated: hint actions had no progress ${hintDeadEndStreak} times; ending attempt early for hierarchy retry`
                  );
                }
              }
            }
            if (
              contextGateActive &&
              !categoryContextGateOpen &&
              attemptSignal.hintNavigateSuccess >= minHintSignalsForContext
            ) {
              const currentUrl = driver?.currentUrl();
              const remainsAtRoot =
                Boolean(currentUrl) &&
                isRootHomepageUrl(currentUrl) &&
                sameHostFamily(currentUrl, targetSiteUrl);
              if (remainsAtRoot && !stepwiseCategoryReady) {
                this.log(
                  state,
                  'warn',
                  `Category context gate deferred: still at root URL (${currentUrl ?? 'n/a'}) despite hint_success=${attemptSignal.hintNavigateSuccess}`
                );
              } else {
                categoryContextGateOpen = true;
                this.log(
                  state,
                  'info',
                  `Category context gate opened after hint_success=${attemptSignal.hintNavigateSuccess}`
                );
              }
            }
            await this.emitSnapshot(sessionId);
          }

          if (menuFirstEnforced) {
            if (stepwiseCategoryReady) {
              categoryContextCarryOver = true;
            }
            this.log(
              state,
              'info',
              `Attempt signals: hint_success=${attemptSignal.hintNavigateSuccess}, hint_skipped=${attemptSignal.hintNavigateSkipped}, search_ok=${attemptSignal.searchActionSucceeded}, filter_ok=${attemptSignal.filterActionSucceeded}, budget_ok=${attemptSignal.budgetFilterSucceeded}, color_ok=${attemptSignal.colorFilterSucceeded}, stage_root=${stepwiseRootReady}, stage_category=${stepwiseCategoryReady}`
            );
            if (attempt === 1 && attemptSignal.searchActionSucceeded > 0) {
              this.log(
                state,
                'warn',
                'Strict menu-first policy: search fallback succeeded too early; forcing retry with hierarchy traversal first'
              );
              if (this.planCacheEnabled && state.activePlanTemplateId) {
                this.planCache.recordResult(state.activePlanTemplateId, 'fail');
                this.log(state, 'info', `Learning signal recorded: template=${state.activePlanTemplateId} result=fail`);
              }
              state.latestSummary = undefined;
              await this.emitSnapshot(sessionId);
              if (attempt < maxAttempts) {
                continue;
              }
            }
            const currentUrlForEvidence = driver?.currentUrl();
            const enteredNonRootContext =
              Boolean(currentUrlForEvidence) &&
              !isRootHomepageUrl(currentUrlForEvidence!) &&
              sameHostFamily(currentUrlForEvidence!, targetSiteUrl);
            if (
              attempt < searchFallbackStartAttempt &&
              attemptSignal.hintNavigateSuccess < minHintSignalsForContext &&
              !enteredNonRootContext
            ) {
              const deadEndDetected =
                attemptSignal.hintNavigateSuccess === 0 &&
                attemptSignal.hintNavigateSkipped >= 2;
              if (deadEndDetected) {
                this.log(
                  state,
                  'warn',
                  'Strict menu-first policy retained: repeated hint dead-end detected, retrying hierarchy traversal'
                );
              }
              this.log(
                state,
                'warn',
                `Strict menu-first policy: insufficient hierarchy traversal evidence (success=${attemptSignal.hintNavigateSuccess}, required=${minHintSignalsForContext}); retrying`
              );
              if (this.planCacheEnabled && state.activePlanTemplateId) {
                this.planCache.recordResult(state.activePlanTemplateId, 'fail');
                this.log(state, 'info', `Learning signal recorded: template=${state.activePlanTemplateId} result=fail`);
              }
              state.latestSummary = undefined;
              await this.emitSnapshot(sessionId);
              if (attempt < maxAttempts) {
                continue;
              }
            }
            if (
              attempt < searchFallbackStartAttempt &&
              attemptSignal.hintNavigateSuccess < minHintSignalsForContext &&
              enteredNonRootContext
            ) {
              this.log(
                state,
                'info',
                `Strict menu-first policy: hierarchy evidence accepted via non-root context (url=${currentUrlForEvidence})`
              );
            }
          }

          if (!intent.wantsSummary) {
            listingValidated = true;
            break;
          }

          if (!driver) {
            listingValidated = true;
            this.log(state, 'info', 'Result validation skipped: browser executor inactive');
            break;
          }

          state.latestSummary = await driver.summarizeCurrentPage(intent.summaryCount, listingSummaryOptions);
          this.log(
            state,
            'info',
            `Summary refreshed for validation (attempt=${attempt}; max=${intent.summaryCount})`
          );
          this.log(state, 'info', `Summary preview: ${summaryPreview(state.latestSummary)}`);

          if (!state.latestSummary || state.latestSummary.trim().length === 0) {
            this.log(state, 'warn', 'Result validation failed: summary is empty');
            if (attempt < maxAttempts) {
              continue;
            }
            break;
          }

          const validation = await this.validateResultWithLlm(state, task, intent, state.latestSummary);
          state.latestValidationMissingConstraints = validation.missingConstraints;
          state.latestValidationReason = validation.reason;
          this.log(
            state,
            validation.valid ? 'info' : 'warn',
            `Result validation: valid=${validation.valid} confidence=${validation.confidence.toFixed(2)} source=${validation.source}${validation.tier ? ` tier=${validation.tier}` : ''}${validation.provider ? ` provider=${validation.provider}` : ''}${validation.model ? ` model=${validation.model}` : ''} reason=${validation.reason}`
          );
          if (validation.missingConstraints.length > 0) {
            this.log(state, 'warn', `Result validation missing constraints: ${validation.missingConstraints.join(', ')}`);
          }
          if (validation.retryHints.length > 0) {
            this.log(state, 'info', `Result validation retry hints: ${validation.retryHints.join(' | ')}`);
          }

          if (validation.valid) {
            listingValidated = true;
            state.latestValidationMissingConstraints = [];
            state.latestValidationReason = validation.reason;
            break;
          }

          if (this.planCacheEnabled && state.activePlanTemplateId) {
            this.planCache.recordResult(state.activePlanTemplateId, 'fail');
            this.log(state, 'info', `Learning signal recorded: template=${state.activePlanTemplateId} result=fail`);
          }

          if (attempt < maxAttempts) {
            this.log(
              state,
              'warn',
              `Result validation rejected attempt ${attempt}; retrying with alternate strategy`
            );
            state.latestSummary = undefined;
            await this.emitSnapshot(sessionId);
          }
        }

        if (!listingValidated && intent.wantsSummary) {
          this.log(state, 'warn', 'Listing result remained low-confidence after all strategy attempts');
          state.latestSummaryLowConfidence = true;
          const unmet = state.latestValidationMissingConstraints ?? [];
          const unmetText = unmet.length > 0 ? unmet.join(', ') : 'validation confidence remained low';
          state.latestSummary = [
            'No confident matching result found after multi-strategy retries.',
            `Unmet constraints: ${unmetText}.`,
            'Please review screenshots/logs and refine category/keyword guidance for the next turn.'
          ].join('\n');
        } else {
          state.latestSummaryLowConfidence = false;
        }
      } else if (step.kind === 'verify' && intent.wantsSummary && !state.latestSummary && driver) {
        state.latestSummary = await driver.summarizeCurrentPage(intent.summaryCount, listingSummaryOptions);
        this.log(state, 'info', `Summary extracted during verify step (max=${intent.summaryCount})`);
        this.log(state, 'info', `Summary preview: ${summaryPreview(state.latestSummary)}`);
      }

      if (driver) {
        const stepLogs = state.logs.slice(stepLogStartIndex);
        const captureReason = this.classifyStepScreenshotReason(step, stepLogs);
        if (captureReason && this.shouldCaptureStepScreenshot(step)) {
          await this.captureRuntimeScreenshot(
            state,
            driver,
            `step-${stepIndex + 1}-${step.kind}-${captureReason}`
          );
        }
      }

      await sleep(this.stepDelayMs);
    } catch (error) {
      if (driver) {
        await this.captureRuntimeScreenshot(state, driver, `step-${stepIndex + 1}-${step.kind}-error`);
      }
      stepSpan.endError(error);
      throw error;
    } finally {
      stepSpan.endSuccess();
    }
  }

  private async runTask(sessionId: string, state: SessionRuntimeState, task: ChatAutomationTask): Promise<void> {
    state.canceled = false;
    state.run.runId = task.id;
    state.run.status = state.paused ? 'paused' : 'running';
    state.run.browserMode = task.browserMode;
    state.run.startedAt = nowIso();
    state.run.updatedAt = state.run.startedAt;
    state.run.lastMessage = task.content;
    state.run.lastError = undefined;
    state.run.step = 0;
    state.run.totalSteps = 0;
    state.run.currentStepTitle = undefined;
    state.run.waitingCaptcha = false;
    state.run.captchaPrompt = undefined;
    state.activePlanTemplateId = undefined;
    state.latestSummary = undefined;
    state.latestSummaryLowConfidence = false;
    state.latestValidationMissingConstraints = undefined;
    state.latestValidationReason = undefined;
    state.run.planCacheHit = undefined;
    state.run.planCacheScore = undefined;
    state.run.planTemplateId = undefined;
    const runSpan = this.telemetry.startSpan('chat_automation.run', {
      session_id: sessionId,
      run_id: task.id,
      browser_mode: task.browserMode,
      execution_mode: this.executionMode,
      planner_mode: this.plannerMode,
      attachment_count: task.attachments.length,
      user_message_length: task.content.length,
      [LF_ATTR.traceName]: 'chat_automation.run',
      [LF_ATTR.traceSessionId]: sessionId,
      [LF_ATTR.traceUserId]: state.operatorId,
      [LF_ATTR.traceInput]: truncateForTelemetry(task.content),
      [LF_ATTR.traceMetadata]: JSON.stringify({
        browserMode: task.browserMode,
        executionMode: this.executionMode,
        plannerMode: this.plannerMode,
        attachmentCount: task.attachments.length
      })
    });
    state.runSpan = runSpan;

    if (this.telemetry.initWarning && !this.telemetryInitWarningLogged) {
      this.telemetryInitWarningLogged = true;
      this.log(state, 'warn', `Langfuse telemetry disabled: ${this.telemetry.initWarning}`);
    }

    let runSucceeded = false;
    try {
      const intent = parseTaskIntent(task.content);
      const analysis = await this.analyzeTaskWithLlm(state, task, intent);
      runSpan.setAttribute('analysis_source', analysis.source);
      runSpan.setAttribute('analysis_confidence', analysis.confidence);
      if (analysis.provider) {
        runSpan.setAttribute('analysis_provider', analysis.provider);
      }
      if (analysis.model) {
        runSpan.setAttribute('analysis_model', analysis.model);
      }

      const plan = this.resolvePlan(task);
      const steps = plan.steps;
      state.activePlanTemplateId = plan.templateId;
      state.run.planCacheHit = plan.cacheHit;
      state.run.planCacheScore = plan.score;
      state.run.planTemplateId = plan.templateId;
      runSpan.setAttribute('plan_cache_hit', plan.cacheHit);
      runSpan.setAttribute('step_count', steps.length);
      if (typeof plan.score === 'number') {
        runSpan.setAttribute('plan_cache_score', plan.score);
      }
      if (plan.templateId) {
        runSpan.setAttribute('plan_template_id', plan.templateId);
      }

      if (plan.cacheHit) {
        this.log(
          state,
          'info',
          `Plan cache hit (score=${(plan.score ?? 0).toFixed(3)} template=${plan.templateId})`
        );
      } else if (this.planCacheEnabled && !state.activePlanTemplateId) {
        const seeded = this.planCache.storeTemplate({
          workflowId: 'chat-automation-default',
          goal: task.content,
          domain: detectDomainFromMessage(task.content),
          steps: toPlanCacheSteps(steps),
          status: 'pass'
        });
        state.activePlanTemplateId = seeded.id;
        state.run.planTemplateId = seeded.id;
        runSpan.setAttribute('plan_template_id', seeded.id);
        this.log(state, 'info', `Plan cache template seeded for learning (template=${seeded.id})`);
      }

      this.log(
        state,
        'info',
        `Run started (${task.browserMode}) with ${steps.length} steps; target=${detectSiteFromMessage(task.content)}; attachments=${task.attachments.length}`
      );
      this.log(state, 'info', `Execution mode: ${this.executionMode}`);
      this.log(state, 'info', `Planner mode: ${this.plannerMode}`);
      this.log(
        state,
        'info',
        `Automation LLM tier policy: ${resolveChatAutomationAllowProEscalation() ? 'flash_then_pro' : 'flash_only'}`
      );
      this.log(
        state,
        'info',
        `Task analysis: source=${analysis.source}${analysis.tier ? ` tier=${analysis.tier}` : ''}${analysis.provider ? ` provider=${analysis.provider}` : ''}${analysis.model ? ` model=${analysis.model}` : ''} type=${analysis.taskType} site=${analysis.siteType} strategy=${analysis.recommendedStrategy ?? 'n/a'} confidence=${analysis.confidence.toFixed(2)}`
      );
      this.log(state, 'info', `Task goal summary: ${analysis.goalSummary}`);
      if (analysis.stagedApproach.length > 0) {
        this.log(state, 'info', `Task staged approach: ${analysis.stagedApproach.join(' -> ')}`);
      }
      if (analysis.strategyOptions.length > 0) {
        const strategyRows = analysis.strategyOptions
          .map((row) => row.name)
          .join(', ');
        this.log(state, 'info', `Task strategy options: ${strategyRows}`);
      }
      if (analysis.constraintBuckets.must.length > 0 || analysis.constraintBuckets.prefer.length > 0 || analysis.constraintBuckets.avoid.length > 0) {
        this.log(
          state,
          'info',
          `Task constraints: must=[${analysis.constraintBuckets.must.join(', ')}] prefer=[${analysis.constraintBuckets.prefer.join(', ')}] avoid=[${analysis.constraintBuckets.avoid.join(', ')}]`
        );
      }
      if (task.attachments.length > 0) {
        const names = task.attachments.map((entry) => entry.name).join(', ');
        this.log(state, 'info', `Attachment-aware flow enabled for: ${names}`);
      }
      if (intent.wantsSummary) {
        this.log(state, 'info', `Summary intent detected (limit=${intent.summaryCount})`);
      }
      if (intent.wantsListingNavigation && intent.listingPathHints.length > 0) {
        this.log(state, 'info', `Listing hints: ${intent.listingPathHints.join(', ')}`);
      }
      if (intent.hierarchyHintGroups.length > 0) {
        const hierarchyText = intent.hierarchyHintGroups
          .map((group, index) => `L${index + 1}=[${group.join(', ')}]`)
          .join(' ');
        this.log(state, 'info', `Hierarchy hint groups: ${hierarchyText}`);
      }
      if (intent.requiredKeywords.length > 0) {
        this.log(state, 'info', `Required keywords: ${intent.requiredKeywords.join(', ')}`);
      }
      if (intent.searchQuery) {
        this.log(state, 'info', `Search query seed: ${intent.searchQuery}`);
      }
      if (intent.searchQueryVariants.length > 1) {
        this.log(state, 'info', `Search query variants: ${intent.searchQueryVariants.join(' | ')}`);
      }
      if (intent.resultExpectation) {
        this.log(state, 'info', `Result expectation: ${intent.resultExpectation.label}`);
      }
      if (intent.sortPriceAsc) {
        this.log(state, 'info', 'Listing sort requested: price ascending');
      }
      if (intent.listingFilter) {
        this.log(
          state,
          'info',
          `Listing filter: ${JSON.stringify(intent.listingFilter)}`
        );
      }
      await this.appendTurn(sessionId, {
        role: 'assistant',
        content:
          task.attachments.length > 0
            ? `Automation started in ${task.browserMode} mode with ${task.attachments.length} image attachment(s).`
            : `Automation started in ${task.browserMode} mode.`
      });
      await this.emitSnapshot(sessionId);

      let driver: ChatPlaywrightDriver | undefined;
      if (this.executionMode === 'playwright') {
        await mkdir(this.runtimeScreenshotRoot, { recursive: true });
        driver = new ChatPlaywrightDriver({
          browserMode: task.browserMode,
          screenshotRoot: this.runtimeScreenshotRoot,
          runId: task.id,
          sessionId
        });
        const startLogs = await driver.start();
        this.logDriverMessages(state, startLogs);
        if (
          task.browserMode === 'headful' &&
          startLogs.some(
            (entry) => entry.level === 'warn' && entry.message.includes('Headful launch failed')
          )
        ) {
          await this.appendTurn(sessionId, {
            role: 'assistant',
            content:
              'Headful browser launch failed in current environment, so run continued in headless mode. Check execution logs for launch error details.'
          });
        }
        const hasStartupIssue = startLogs.some((entry) => {
          if (entry.level === 'error') {
            return true;
          }
          if (entry.level !== 'warn') {
            return false;
          }
          return !entry.message.includes('Headful launch failed');
        });
        if (hasStartupIssue) {
          await this.captureRuntimeScreenshot(state, driver, 'session-start-issue');
        }
        await this.emitSnapshot(sessionId);
      }

      const listingSummaryOptions = buildListingPageSummaryOptions(intent);

      try {
        for (let index = 0; index < steps.length; index += 1) {
          if (state.canceled || state.run.runId !== task.id) {
            throw new Error('run canceled');
          }
          await this.executeStep(sessionId, state, steps[index]!, task, index, steps.length, intent, analysis, driver);
        }

        if (driver && intent.wantsSummary && !state.latestSummary) {
          state.latestSummary = await driver.summarizeCurrentPage(intent.summaryCount, listingSummaryOptions);
          this.log(state, 'info', 'Summary extracted after step execution');
        }

        if (intent.wantsSummary && state.latestSummary && !state.latestSummaryLowConfidence) {
          state.latestSummary = await this.rewriteSummaryWithLlm(
            state,
            task.content,
            state.latestSummary,
            intent.summaryCount
          );
        }

        state.run.status = 'completed';
        state.run.updatedAt = nowIso();
        state.run.currentStepTitle = 'Completed';
        this.log(state, 'info', 'Run completed successfully');
        if (this.planCacheEnabled) {
          const workflowId = 'chat-automation-default';
          const domain = detectDomainFromMessage(task.content);
          if (state.activePlanTemplateId) {
            this.planCache.recordResult(state.activePlanTemplateId, 'pass');
          } else {
            const stored = this.planCache.storeTemplate({
              workflowId,
              goal: task.content,
              domain,
              steps: toPlanCacheSteps(steps),
              status: 'pass'
            });
            state.activePlanTemplateId = stored.id;
            state.run.planTemplateId = stored.id;
          }
        }

        const completionSummary =
          state.latestSummary && state.latestSummary.trim().length > 0
            ? `\n\nSummary:\n${state.latestSummary}`
            : '';
        const confidenceNotice = state.latestSummaryLowConfidence
          ? '\n\nWarning: Result confidence is low after multi-strategy retries. Please review screenshot/logs and refine instruction.'
          : '';

        await this.appendTurn(sessionId, {
          role: 'assistant',
          content: `Automation run completed.${completionSummary}${confidenceNotice}\n\nYou can continue with next request or open another session.`
        });
        runSpan.setAttribute(
          LF_ATTR.traceOutput,
          truncateForTelemetry(
            state.latestSummary && state.latestSummary.trim().length > 0
              ? state.latestSummary
              : `status=completed; summary_available=${Boolean(state.latestSummary)}; low_confidence=${Boolean(
                  state.latestSummaryLowConfidence
                )}`
          )
        );
        await this.emitSnapshot(sessionId);
        runSucceeded = true;
      } finally {
        if (driver) {
          await driver.close();
          this.log(state, 'info', 'Browser runtime closed');
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      runSpan.setAttribute(LF_ATTR.traceOutput, truncateForTelemetry(`status=failed; error=${message}`, 4_000));
      runSpan.setAttribute('run_status', message === 'run canceled' ? 'canceled' : 'failed');
      runSpan.endError(error);
      throw error;
    } finally {
      if (runSucceeded) {
        runSpan.setAttribute('run_status', 'completed');
        runSpan.endSuccess();
      }
      state.runSpan = undefined;
      try {
        await this.telemetry.flush();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.log(state, 'warn', `Langfuse flush failed: ${message}`);
      }
    }
  }

  private async startWorkerIfNeeded(sessionId: string): Promise<void> {
    const session = await this.mustGetSession(sessionId);
    const state = this.ensureRuntime(session);

    if (state.workerRunning) {
      return;
    }

    state.workerRunning = true;

    void (async () => {
      try {
        while (state.queue.length > 0) {
          await this.waitWhilePaused(state);
          const task = state.queue.shift();
          if (!task) {
            continue;
          }

          try {
            await this.runTask(sessionId, state, task);
          } catch (error) {
            const message = (error as Error).message;

            if (message === 'run canceled') {
              state.run.status = 'canceled';
              state.run.updatedAt = nowIso();
              this.log(state, 'warn', 'Run canceled');
              await this.emitSnapshot(sessionId);
              continue;
            }

            if (isSessionMissingError(error)) {
              state.queue = [];
              state.run.queueLength = 0;
              state.workerRunning = false;
              return;
            }

            state.run.status = 'failed';
            state.run.lastError = message;
            state.run.updatedAt = nowIso();
            if (this.planCacheEnabled && state.activePlanTemplateId) {
              this.planCache.recordResult(state.activePlanTemplateId, 'fail');
            }
            this.log(state, 'error', `Run failed: ${message}`);
            try {
              await this.appendTurn(sessionId, {
                role: 'assistant',
                content: `Run failed: ${message}`
              });
              await this.emitSnapshot(sessionId);
            } catch (appendError) {
              if (!isSessionMissingError(appendError)) {
                throw appendError;
              }
            }
            state.activePlanTemplateId = undefined;
          }
        }
      } finally {
        state.workerRunning = false;
        state.run.queueLength = state.queue.length;
      }
    })();
  }

  async sendMessage(input: SendMessageInput): Promise<ChatAutomationSessionSnapshot> {
    const content = ensureNonEmpty(input.content, 'content');
    const attachments = normalizeAttachments(input.attachments);

    const session = await this.mustGetSession(input.sessionId);
    const state = this.ensureRuntime(session);

    if (input.operatorId) {
      state.operatorId = input.operatorId;
    }

    await this.appendTurn(input.sessionId, {
      role: 'user',
      content,
      metadata:
        attachments.length > 0
          ? {
              attachments
            }
          : undefined
    });

    const now = nowIso();
    state.queue.push({
      id: `${input.sessionId}-run-${now.replace(/[-:.TZ]/g, '')}-${state.queue.length + 1}`,
      content,
      browserMode: input.browserMode,
      requestedAt: now,
      attachments
    });
    state.run.queueLength = state.queue.length;

    this.log(
      state,
      'info',
      `User message queued (${input.browserMode}) with ${attachments.length} attachment(s)`
    );

    const firstAttachmentWithPath = attachments.find((entry) => entry.path);
    if (firstAttachmentWithPath?.path) {
      this.recordScreenshot(state, {
        path: firstAttachmentWithPath.path,
        source: 'attachment',
        capturedAt: now,
        label: firstAttachmentWithPath.name || 'attachment'
      });
    }

    if (input.autoPauseOthers ?? true) {
      await this.pauseOtherSessions(state.operatorId, input.sessionId);
    }

    state.paused = false;
    await this.emitSnapshot(input.sessionId);
    await this.startWorkerIfNeeded(input.sessionId);

    return this.getSnapshot(input.sessionId);
  }

  async pauseSession(sessionId: string): Promise<ChatAutomationSessionSnapshot> {
    const session = await this.mustGetSession(sessionId);
    const state = this.ensureRuntime(session);
    state.paused = true;

    if (state.run.status === 'running' || state.run.status === 'waiting_captcha') {
      state.run.status = 'paused';
      state.run.updatedAt = nowIso();
    }

    this.log(state, 'warn', 'Session paused by user');
    await this.emitSnapshot(sessionId);
    return this.getSnapshot(sessionId);
  }

  async resumeSession(sessionId: string): Promise<ChatAutomationSessionSnapshot> {
    const session = await this.mustGetSession(sessionId);
    const state = this.ensureRuntime(session);
    state.paused = false;

    if (state.run.waitingCaptcha) {
      state.run.status = 'waiting_captcha';
    } else if (state.run.status === 'paused') {
      state.run.status = state.workerRunning ? 'running' : state.run.status;
    }

    state.run.updatedAt = nowIso();
    this.log(state, 'info', 'Session resumed by user');
    await this.emitSnapshot(sessionId);
    await this.startWorkerIfNeeded(sessionId);
    return this.getSnapshot(sessionId);
  }

  async cancelSession(sessionId: string): Promise<ChatAutomationSessionSnapshot> {
    const session = await this.mustGetSession(sessionId);
    const state = this.ensureRuntime(session);
    state.canceled = true;
    state.queue = [];
    state.run.queueLength = 0;
    state.pendingCaptchaValue = undefined;
    state.run.waitingCaptcha = false;
    state.run.captchaPrompt = undefined;
    state.run.status = 'canceled';
    state.run.updatedAt = nowIso();
    for (const handoff of state.handoffs) {
      if (handoff.status === 'waiting') {
        handoff.status = 'canceled';
      }
    }
    this.log(state, 'warn', 'Session canceled by user');
    await this.emitSnapshot(sessionId);
    return this.getSnapshot(sessionId);
  }

  async resolveHandoff(input: ResolveHandoffInput): Promise<ChatAutomationSessionSnapshot> {
    const session = await this.mustGetSession(input.sessionId);
    const state = this.ensureRuntime(session);
    const actionTaken = ensureNonEmpty(input.actionTaken, 'actionTaken');
    const resolvedBy = input.resolvedBy?.trim() || 'operator';

    const handoff = state.handoffs.find((entry) => entry.id === input.handoffId);
    if (!handoff) {
      throw new Error(`handoff not found: ${input.handoffId}`);
    }
    if (handoff.status !== 'waiting') {
      throw new Error(`handoff is not waiting: ${input.handoffId}`);
    }

    handoff.status = 'resolved';
    handoff.resolvedAt = nowIso();

    const submittedValue = input.value?.trim();
    if (submittedValue) {
      handoff.valueLength = submittedValue.length;
    }

    if (handoff.type === 'captcha') {
      if (!submittedValue) {
        throw new Error('captcha handoff resolve requires value');
      }
      state.pendingCaptchaValue = submittedValue;
      state.run.waitingCaptcha = false;
      state.run.captchaPrompt = undefined;
    }

    this.log(
      state,
      'info',
      `Handoff resolved by ${resolvedBy}: ${actionTaken}${submittedValue ? ` (value length=${submittedValue.length})` : ''}`
    );
    await this.appendTurn(input.sessionId, {
      role: 'assistant',
      content:
        handoff.type === 'captcha'
          ? 'Handoff resolved by user. Continuing captcha-required automation step.'
          : `Handoff resolved by user with action: ${actionTaken}.`
    });
    state.run.updatedAt = nowIso();
    await this.emitSnapshot(input.sessionId);
    return this.getSnapshot(input.sessionId);
  }

  async submitCaptcha(input: SubmitCaptchaInput): Promise<ChatAutomationSessionSnapshot> {
    const value = ensureNonEmpty(input.value, 'captcha value');
    const session = await this.mustGetSession(input.sessionId);
    const state = this.ensureRuntime(session);

    state.pendingCaptchaValue = value;
    state.run.updatedAt = nowIso();
    this.log(state, 'info', `Captcha submitted by user (length=${value.length})`);
    await this.emitSnapshot(input.sessionId);
    return this.getSnapshot(input.sessionId);
  }
}
