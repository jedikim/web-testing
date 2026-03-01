import { mkdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import { Jimp } from 'jimp';
import type { Browser, BrowserContext, Locator, Page } from 'playwright';

import {
  buildCandidateContext,
  buildCandidateContextWithSemanticRerank,
  PageScopedEmbeddingCache,
  type CandidateIntent,
  type CandidateItem
} from '../fallback/context-reducer';
import { embedTextsLocally } from '../fallback/local-semantic-embed';
import type { VectorBackend } from '../fallback/in-memory-vector-index';
import { buildCompositeSheet, type CompositeSourceImage } from '../vision/composite-sheet';
import { executeRepeatedItemJudgement } from '../vision/repeated-item-judgement';
import { runRfDetrLocal } from '../vision/rfdetr-local';

export type DriverLogLevel = 'info' | 'warn' | 'error';

export interface DriverLog {
  level: DriverLogLevel;
  message: string;
}

export interface ChatPlaywrightDriverOptions {
  browserMode: 'headful' | 'headless';
  screenshotRoot?: string;
  runId: string;
  sessionId: string;
}

export interface ClickResult {
  clicked: boolean;
  selector?: string;
  text?: string;
  urlAfter?: string;
}

interface ListingProductRow {
  name: string;
  lumpSumLabel: string;
  lumpSumValue: number;
  installmentLabel: string;
  installmentMonthlyValue: number;
  installmentMonths?: number;
  installmentTotalValue: number;
  priceBasis: 'lump_sum' | 'installment' | 'unknown';
  sortPrice: number;
  inchValue?: number;
  isRental: boolean;
  isWomenWear: boolean;
  isHikingWear: boolean;
  isRed: boolean;
  source: 'prod_list' | 'search';
  domIndex: number;
}

interface ListingProductFilter {
  preferInch?: number;
  excludeRental?: boolean;
  requireWomenWear?: boolean;
  requireHikingWear?: boolean;
  requireRedColor?: boolean;
  maxLumpSum?: number;
}

interface ListingPageSummaryOptions {
  filter?: ListingProductFilter;
  modeLabel?: string;
}

interface PageSummaryOptions {
  listing?: ListingPageSummaryOptions;
}

interface ListingVisualDecision {
  orderedProducts: ListingProductRow[];
  evidenceLines: string[];
}

export interface ActionObjective {
  includeAny?: string[];
  avoidAny?: string[];
  strict?: boolean;
}

export interface ListingNavigationOptions {
  pathHints?: string[];
  sortPriceAsc?: boolean;
  maxPathSteps?: number;
  objective?: ActionObjective;
}

export interface GenericClickOptions {
  selectors?: string[];
  textHints?: string[];
  label?: string;
  objective?: ActionObjective;
}

export interface GenericTypeOptions {
  selectors?: string[];
  textHints?: string[];
  value: string;
  submit?: boolean;
  label?: string;
  intent?: 'search' | 'filter' | 'auto';
  allowBudgetFallback?: boolean;
}

interface DomActionCandidate extends CandidateItem {
  selector: string;
  href?: string;
}

interface RankedCandidateSet {
  candidates: DomActionCandidate[];
  metadata?: {
    strategy: string;
    vectorBackend?: string;
    structureFirstPoolSize?: number;
    returnedCandidates?: number;
    embeddedCandidateCount?: number;
  };
}

interface NavigationVlmTarget {
  apiKey: string;
  model: string;
  baseUrl: string;
}

function normalizeText(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim();
}

function normalizeComparableText(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9가-힣]+/g, '');
}

function resolveRegistrableDomain(hostname: string): string | undefined {
  const host = hostname
    .trim()
    .toLowerCase()
    .replace(/\.$/, '');
  if (!host) {
    return undefined;
  }
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) || host === 'localhost') {
    return host;
  }
  const labels = host.split('.').filter((row) => row.length > 0);
  if (labels.length < 2) {
    return host;
  }

  const secondLevelSuffixes = new Set([
    'co.kr',
    'or.kr',
    'go.kr',
    'ac.kr',
    'ne.kr',
    're.kr',
    'co.uk',
    'org.uk',
    'gov.uk',
    'ac.uk',
    'com.au',
    'net.au',
    'org.au',
    'co.jp',
    'co.nz'
  ]);
  const lastTwo = labels.slice(-2).join('.');
  if (labels.length >= 3 && secondLevelSuffixes.has(lastTwo)) {
    return labels.slice(-3).join('.');
  }
  return lastTwo;
}

function resolveRegistrableDomainFromUrl(rawUrl: string): string | undefined {
  try {
    const parsed = new URL(rawUrl);
    return resolveRegistrableDomain(parsed.hostname);
  } catch {
    return undefined;
  }
}

function resolveVectorBackend(raw: string | undefined): VectorBackend {
  const normalized = (raw ?? '').trim().toLowerCase();
  if (normalized === 'hnsw') {
    return 'hnsw';
  }
  if (normalized === 'bruteforce') {
    return 'bruteforce';
  }
  return 'auto';
}

function sanitizePathPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '-');
}

function parseBoolean(raw: string | undefined): boolean {
  const normalized = raw?.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
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

function extractJsonObject(raw: string): Record<string, unknown> | undefined {
  const fenced = raw.match(/```json\s*([\s\S]*?)```/i) ?? raw.match(/```\s*([\s\S]*?)```/i);
  const candidates = [fenced?.[1], raw].filter((value): value is string => typeof value === 'string');
  for (const candidate of candidates) {
    const started = candidate.indexOf('{');
    const ended = candidate.lastIndexOf('}');
    if (started < 0 || ended <= started) {
      continue;
    }
    const chunk = candidate.slice(started, ended + 1);
    try {
      const parsed = JSON.parse(chunk);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      continue;
    }
  }
  return undefined;
}

async function ignore<T>(action: Promise<T>): Promise<T | undefined> {
  try {
    return await action;
  } catch {
    return undefined;
  }
}

function isRecoverableClickError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    /locator\.hover:\s*Timeout/i.test(message) ||
    /Timeout .*hover/i.test(message) ||
    /locator\.click:\s*Timeout/i.test(message) ||
    /Timeout \d+ms exceeded/i.test(message) ||
    /Timeout .*click/i.test(message) ||
    /outside of the viewport/i.test(message) ||
    /intercepts pointer events/i.test(message) ||
    /element is not stable/i.test(message) ||
    /element was detached/i.test(message) ||
    /Element is not attached/i.test(message)
  );
}

function isTransientNavigationError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes('Execution context was destroyed') ||
    message.includes('Cannot find context') ||
    message.includes('Navigation interrupted') ||
    message.includes('Target page, context or browser has been closed')
  );
}

function isRecoverableFillError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    /cannot be filled/i.test(message) ||
    /not editable/i.test(message) ||
    /is not an <input>/i.test(message) ||
    /element is not visible/i.test(message) ||
    /element is not attached/i.test(message)
  );
}

function stripHash(url: string): string {
  const index = url.indexOf('#');
  return index >= 0 ? url.slice(0, index) : url;
}

function looksPromotionLike(url: string, title?: string): boolean {
  const normalizedUrl = url.toLowerCase();
  const normalizedTitle = (title ?? '').toLowerCase();
  return (
    /\/(plan|event|promo|promotion|guide)(\/|$|\?)/i.test(normalizedUrl) ||
    /기획전|이벤트|프로모션|promotion|event|special/i.test(normalizedTitle)
  );
}

function sameAllowedRoot(url: string, allowedRoot: string | undefined): boolean {
  if (!allowedRoot) {
    return true;
  }
  const resolved = resolveRegistrableDomainFromUrl(url);
  if (!resolved) {
    return false;
  }
  return resolved === allowedRoot || resolved.endsWith(`.${allowedRoot}`) || allowedRoot.endsWith(`.${resolved}`);
}

export class ChatPlaywrightDriver {
  private readonly options: ChatPlaywrightDriverOptions;
  private browser?: Browser;
  private context?: BrowserContext;
  private page?: Page;
  private screenshotDir?: string;
  private screenshotCount = 0;
  private allowedRootDomain?: string;
  private readonly candidateEmbeddingCache = new PageScopedEmbeddingCache();

  constructor(options: ChatPlaywrightDriverOptions) {
    this.options = options;
  }

  currentUrl(): string | undefined {
    return this.page?.url();
  }

  private requirePage(): Page {
    if (!this.page) {
      throw new Error('playwright page is not initialized');
    }
    return this.page;
  }

  private semanticRerankEnabled(): boolean {
    return parseBoolean(process.env.CHAT_AUTOMATION_SEMANTIC_RERANK_ENABLED ?? '1');
  }

  private semanticRerankMinCandidates(): number {
    const configured = parseOptionalNumber(process.env.CHAT_AUTOMATION_SEMANTIC_RERANK_MIN_CANDIDATES);
    if (!configured || !Number.isFinite(configured)) {
      return 24;
    }
    return Math.min(200, Math.max(8, Math.floor(configured)));
  }

  private candidateStructureFirstLimit(): number {
    const configured = parseOptionalNumber(process.env.CHAT_AUTOMATION_STRUCTURE_FIRST_LIMIT);
    if (!configured || !Number.isFinite(configured)) {
      return 50;
    }
    return Math.min(240, Math.max(16, Math.floor(configured)));
  }

  private candidateMaxSelected(): number {
    const configured = parseOptionalNumber(process.env.CHAT_AUTOMATION_MAX_REDUCED_CANDIDATES);
    if (!configured || !Number.isFinite(configured)) {
      return 8;
    }
    return Math.min(40, Math.max(1, Math.floor(configured)));
  }

  private candidateVectorBackend(): VectorBackend {
    return resolveVectorBackend(process.env.CHAT_AUTOMATION_VECTOR_BACKEND);
  }

  private currentPageKey(): string {
    const page = this.requirePage();
    return `${this.options.sessionId}:${this.options.runId}:${page.url()}`;
  }

  private navVlmEnabled(): boolean {
    return parseBoolean(process.env.CHAT_AUTOMATION_NAV_VLM_ENABLED ?? '0');
  }

  private resolveNavigationVlmTarget(): NavigationVlmTarget | undefined {
    const apiKey = firstNonEmpty([process.env.GEMINI_API_KEY]);
    if (!apiKey) {
      return undefined;
    }
    const configuredModels = parseCsv(process.env.GEMINI_MODELS);
    const model =
      firstNonEmpty([
        process.env.BACKEND_AUTOMATION_GEMINI_MODEL,
        configuredModels.find((value) => /flash/i.test(value)),
        configuredModels[0]
      ]) ?? 'gemini-3-flash-preview';
    const rawBaseUrl =
      firstNonEmpty([process.env.GEMINI_BASE_URL]) ?? 'https://generativelanguage.googleapis.com/v1beta';
    let baseUrl = rawBaseUrl;
    try {
      const parsed = new URL(rawBaseUrl);
      const normalizedPath = parsed.pathname.replace(/\/+$/, '');
      if (parsed.hostname.toLowerCase() === 'generativelanguage.googleapis.com' && !/^\/v\d/i.test(normalizedPath)) {
        baseUrl = `${parsed.origin}/v1beta`;
      } else {
        baseUrl = `${parsed.origin}${normalizedPath}`;
      }
    } catch {
      baseUrl = rawBaseUrl;
    }
    return {
      apiKey,
      model,
      baseUrl
    };
  }

  private isGenericNavigationRootHint(raw: string): boolean {
    const value = normalizeText(raw).toLowerCase();
    if (!value) {
      return false;
    }
    return /(카테고리|전체카테고리|메뉴|menu|category|navigation|nav|전체)/i.test(value);
  }

  private expandNavigationHints(
    hints: string[],
    options?: {
      broad?: boolean;
    }
  ): string[] {
    const broad = options?.broad !== false;
    const dictionary = [
      '카테고리',
      '메뉴',
      '전체',
      '여성',
      '남성',
      '스포츠',
      '의류',
      '패션',
      '등산',
      '아웃도어',
      '골프',
      '런닝',
      '러닝',
      '신발',
      '가전',
      '디지털',
      '컴퓨터'
    ];
    const expanded = new Set<string>();
    for (const raw of hints) {
      const normalized = normalizeText(raw).toLowerCase();
      if (!normalized) {
        continue;
      }
      expanded.add(normalized);
      const fragments = normalized
        .split(/[^a-z0-9가-힣]+/g)
        .map((item) => item.trim())
        .filter((item) => item.length >= 2);
      for (const token of fragments) {
        expanded.add(token);
      }
      const spacedForm = normalized
        .replace(/(여성|남성|스포츠|의류|등산복|등산|아웃도어|골프|러닝|런닝)/g, ' $1 ')
        .replace(/\s+/g, ' ')
        .trim();
      if (spacedForm.length >= 2 && spacedForm !== normalized) {
        expanded.add(spacedForm);
      }
      if (broad) {
        for (const keyword of dictionary) {
          if (normalized.includes(keyword)) {
            expanded.add(keyword);
          }
        }
      }
      if (normalized.endsWith('의류') && normalized.length > 3) {
        expanded.add('의류');
        expanded.add(normalized.slice(0, normalized.length - 2));
      }
      if (broad && (normalized.endsWith('등산복') || normalized.includes('등산복'))) {
        expanded.add('등산');
        expanded.add('아웃도어');
      }
      if (broad && (normalized.endsWith('스포츠의류') || normalized.includes('스포츠의류'))) {
        expanded.add('스포츠');
        expanded.add('의류');
      }
      if (broad && (normalized.endsWith('여성스포츠의류') || normalized.includes('여성스포츠의류'))) {
        expanded.add('여성');
        expanded.add('스포츠');
        expanded.add('의류');
      }
    }
    return Array.from(expanded).slice(0, 14);
  }

  private async hasListingContextSignals(): Promise<boolean> {
    const page = this.requirePage();
    const found = await ignore(
      page.evaluate(() => {
        const selectors = [
          '.main_prodlist_list > ul > li.prod_item',
          'li.prod_item',
          '.prod_main_info',
          '[class*="prodlist"]',
          '[class*="product-list"]',
          '[class*="item-list"]',
          '[class*="filter"] input',
          '[class*="filter"] button'
        ];
        for (const selector of selectors) {
          if (document.querySelector(selector)) {
            return true;
          }
        }
        const body = (document.body?.innerText ?? '').replace(/\s+/g, ' ').toLowerCase();
        if (!body) {
          return false;
        }
        if (/(검색결과|검색 결과|필터 적용|선택한 옵션|결과 내 검색|판매처|옵션 초기화)/i.test(body)) {
          return true;
        }
        return false;
      })
    );
    return found === true;
  }

  private async commitNavigationFromOverlay(input: {
    hints: string[];
    objective: ActionObjective | undefined;
    startUrl: string;
    label: string;
  }): Promise<{ committed: boolean; logs: DriverLog[]; clickedText?: string; clickedHref?: string }> {
    const page = this.requirePage();
    const logs: DriverLog[] = [];
    const hints = input.hints
      .map((hint) => normalizeText(hint))
      .filter((hint, index, list) => hint.length > 0 && list.indexOf(hint) === index)
      .slice(0, 6);
    if (hints.length === 0) {
      return { committed: false, logs };
    }

    const rawCandidates = await this.collectClickableCandidates(hints, {
      label: `${input.label}-commit`,
      rootHintMode: false,
      wantsSearch: false,
      wantsFilter: false,
      allowLooseNavigationMatch: false
    });
    const ranked = await this.rankCandidatesByContext(rawCandidates, {
      hints,
      label: `${input.label}-commit`,
      intent: 'navigation',
      forceSemantic: true
    });
    const prioritized = this.prioritizeNavigationScopeCandidates(ranked.candidates, true);
    const pool =
      prioritized.scopedCount > 0
        ? prioritized.ordered.filter((candidate) => this.isNavigationScopeCandidate(candidate))
        : prioritized.ordered;

    for (const candidate of pool.slice(0, 8)) {
      const objectiveCheck = this.candidateMatchesObjective(candidate, input.objective);
      if (!objectiveCheck.ok) {
        continue;
      }
      if (this.isLikelyProductOrAdCandidate(candidate)) {
        continue;
      }

      const locator = page.locator(candidate.selector).first();
      const visible = await ignore(locator.isVisible({ timeout: 1400 }));
      if (!visible) {
        continue;
      }
      const interactable = await this.isLocatorInteractable(locator);
      if (!interactable) {
        continue;
      }

      const beforeUrl = page.url();
      try {
        await locator.hover({ timeout: 2200 });
      } catch (error) {
        if (!isRecoverableClickError(error)) {
          throw error;
        }
      }
      await ignore(page.waitForTimeout(180));

      try {
        await locator.click({ timeout: 2600 });
      } catch (error) {
        if (!isRecoverableClickError(error)) {
          throw error;
        }
        const forced = await this.forceClickBySelector(candidate.selector);
        if (!forced) {
          continue;
        }
      }

      await ignore(page.waitForLoadState('domcontentloaded', { timeout: 12000 }));
      await ignore(page.waitForTimeout(360));
      const afterUrl = page.url();
      const listingSignals = await this.hasListingContextSignals();
      const weak = this.isWeakTransition(beforeUrl, afterUrl, candidate.href);

      if (!sameAllowedRoot(afterUrl, this.allowedRootDomain)) {
        await ignore(page.goBack({ waitUntil: 'domcontentloaded', timeout: 12_000 }));
        await ignore(page.waitForTimeout(260));
        continue;
      }

      if (!weak || listingSignals || stripHash(afterUrl) !== stripHash(input.startUrl)) {
        logs.push({
          level: 'info',
          message: `Hint navigation commit succeeded: text=${candidate.text || hints[0] || 'n/a'} href=${candidate.href ?? 'n/a'} listingSignals=${listingSignals}`
        });
        return {
          committed: true,
          logs,
          clickedText: candidate.text || undefined,
          clickedHref: candidate.href
        };
      }

      const recovered = await this.recoverFromWeakTransition({
        beforeUrl,
        hints,
        objective: input.objective,
        label: `${input.label}-commit`
      });
      logs.push(...recovered.logs);
      if (recovered.recovered) {
        return {
          committed: true,
          logs,
          clickedText: recovered.clickedText,
          clickedHref: recovered.clickedHref
        };
      }
    }

    logs.push({
      level: 'warn',
      message: `Hint navigation commit failed: hints=[${hints.join(', ')}]`
    });
    return { committed: false, logs };
  }

  private async forceClickBySelector(selector: string): Promise<boolean> {
    const page = this.requirePage();
    const clicked = await ignore(
      page.evaluate((targetSelector) => {
        const node = document.querySelector(targetSelector);
        if (!(node instanceof HTMLElement)) {
          return false;
        }
        const rect = node.getBoundingClientRect();
        if (rect.width <= 2 || rect.height <= 2) {
          return false;
        }
        const style = window.getComputedStyle(node);
        if (style.display === 'none' || style.visibility === 'hidden' || style.pointerEvents === 'none') {
          return false;
        }
        node.dispatchEvent(
          new MouseEvent('mouseover', {
            bubbles: true,
            cancelable: true,
            view: window
          })
        );
        node.dispatchEvent(
          new MouseEvent('mousedown', {
            bubbles: true,
            cancelable: true,
            view: window
          })
        );
        node.dispatchEvent(
          new MouseEvent('mouseup', {
            bubbles: true,
            cancelable: true,
            view: window
          })
        );
        node.click();
        return true;
      }, selector)
    );
    return clicked === true;
  }

  private async forceHoverBySelector(selector: string): Promise<boolean> {
    const page = this.requirePage();
    const hovered = await ignore(
      page.evaluate((targetSelector) => {
        const node = document.querySelector(targetSelector);
        if (!(node instanceof HTMLElement)) {
          return false;
        }
        const rect = node.getBoundingClientRect();
        if (rect.width <= 2 || rect.height <= 2) {
          return false;
        }
        node.dispatchEvent(
          new MouseEvent('mouseover', {
            bubbles: true,
            cancelable: true,
            view: window
          })
        );
        node.dispatchEvent(
          new MouseEvent('mouseenter', {
            bubbles: true,
            cancelable: true,
            view: window
          })
        );
        if (typeof PointerEvent === 'function') {
          node.dispatchEvent(
            new PointerEvent('pointerover', {
              bubbles: true,
              cancelable: true
            })
          );
        }
        return true;
      }, selector)
    );
    return hovered === true;
  }

  private async rerankNavigationCandidatesWithVlm(input: {
    candidates: DomActionCandidate[];
    hints: string[];
    objective: ActionObjective | undefined;
    hop: number;
    hopBudget: number;
  }): Promise<{ candidates: DomActionCandidate[]; logs: DriverLog[] }> {
    const logs: DriverLog[] = [];
    if (!this.navVlmEnabled()) {
      return { candidates: input.candidates, logs };
    }
    if (!this.screenshotDir || input.candidates.length < 2) {
      return { candidates: input.candidates, logs };
    }
    const target = this.resolveNavigationVlmTarget();
    if (!target) {
      return { candidates: input.candidates, logs };
    }
    const page = this.requirePage();
    const topCandidates = input.candidates.slice(0, 4);
    const roiImages: CompositeSourceImage[] = [];
    const idToCandidate = new Map<string, DomActionCandidate>();

    for (let index = 0; index < topCandidates.length; index += 1) {
      const candidate = topCandidates[index]!;
      const locator = page.locator(candidate.selector).first();
      const visible = await ignore(locator.isVisible({ timeout: 1000 }));
      if (!visible) {
        continue;
      }
      const interactable = await this.isLocatorInteractable(locator);
      if (!interactable) {
        continue;
      }
      const sourceId = `cand-${index + 1}`;
      const path = join(
        this.screenshotDir,
        `nav-roi-hop-${String(input.hop + 1).padStart(2, '0')}-${sourceId}.png`
      );
      try {
        await locator.scrollIntoViewIfNeeded();
        await locator.screenshot({ path });
        roiImages.push({
          id: sourceId,
          imagePath: path,
          metadata: {
            text: candidate.text,
            role: candidate.role
          }
        });
        idToCandidate.set(sourceId, candidate);
      } catch {
        continue;
      }
    }

    if (roiImages.length < 2) {
      return { candidates: input.candidates, logs };
    }

    const compositePath = join(
      this.screenshotDir,
      `nav-roi-composite-hop-${String(input.hop + 1).padStart(2, '0')}-${Date.now()}.png`
    );
    const built = await buildCompositeSheet({
      images: roiImages,
      outputImagePath: compositePath,
      columns: Math.min(2, roiImages.length),
      cellWidth: 320,
      cellHeight: 200
    });

    const candidateMetaLines = roiImages.map((entry) => {
      const original = idToCandidate.get(entry.id);
      const attributes = original?.attributes ?? {};
      return `${entry.id}: text="${original?.text ?? ''}", role="${original?.role ?? ''}", nearby="${attributes.nearbyText ?? ''}", region="${attributes.region ?? ''}", href="${original?.href ?? ''}"`;
    });
    const objectiveInclude = input.objective?.includeAny?.join(', ') || 'n/a';
    const objectiveAvoid = input.objective?.avoidAny?.join(', ') || 'n/a';
    const prompt = [
      'You are ranking clickable menu/navigation candidates for web traversal.',
      `Hop: ${input.hop + 1}/${input.hopBudget}`,
      `Goal hints: ${input.hints.join(', ')}`,
      `Objective include: ${objectiveInclude}`,
      `Objective avoid: ${objectiveAvoid}`,
      'Candidates:',
      ...candidateMetaLines,
      'Image: a composite where each tile corresponds to candidate id by order (cand-1..cand-n).',
      'Return strict JSON only: {"ranked_ids":["cand-x","cand-y"],"reason":"...","confidence":0.0}'
    ].join('\n');

    const inlineImage = (await readFile(built.imagePath)).toString('base64');
    const response = await fetch(
      `${target.baseUrl}/models/${encodeURIComponent(target.model)}:generateContent?key=${encodeURIComponent(target.apiKey)}`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: prompt },
                {
                  inline_data: {
                    mime_type: 'image/png',
                    data: inlineImage
                  }
                }
              ]
            }
          ],
          generationConfig: {
            temperature: 0.1,
            responseMimeType: 'application/json'
          }
        })
      }
    );

    if (!response.ok) {
      const body = await ignore(response.text());
      logs.push({
        level: 'warn',
        message: `Hint navigation VLM rerank skipped: http=${response.status} body=${(body ?? '').slice(0, 160)}`
      });
      return { candidates: input.candidates, logs };
    }

    const payload = (await response.json()) as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
      }>;
    };
    const outputText =
      payload.candidates?.[0]?.content?.parts
        ?.map((part) => part.text ?? '')
        .join('\n')
        .trim() ?? '';
    const parsed = extractJsonObject(outputText);
    const rankedIds =
      Array.isArray(parsed?.ranked_ids) && parsed?.ranked_ids.length > 0
        ? parsed.ranked_ids
            .map((value) => (typeof value === 'string' ? value.trim() : ''))
            .filter((value) => value.length > 0)
        : [];
    if (rankedIds.length === 0) {
      logs.push({
        level: 'warn',
        message: `Hint navigation VLM rerank returned empty ranking (hop=${input.hop + 1})`
      });
      return { candidates: input.candidates, logs };
    }

    const selected = rankedIds.map((id) => idToCandidate.get(id)).filter((row): row is DomActionCandidate => Boolean(row));
    if (selected.length === 0) {
      logs.push({
        level: 'warn',
        message: `Hint navigation VLM rerank mapping failed (hop=${input.hop + 1})`
      });
      return { candidates: input.candidates, logs };
    }
    const selectedIds = new Set(selected.map((row) => row.id));
    const reordered = [...selected, ...input.candidates.filter((row) => !selectedIds.has(row.id))];
    logs.push({
      level: 'info',
      message: `Hint navigation VLM rerank applied: hop=${input.hop + 1}/${input.hopBudget} selected=[${rankedIds.join(', ')}] composite=${built.imagePath}`
    });
    return {
      candidates: reordered,
      logs
    };
  }

  private resolveHintMaxPathSteps(inputMaxSteps: number | undefined): number {
    const configured = parseOptionalNumber(process.env.CHAT_AUTOMATION_HINT_MAX_PATH_STEPS);
    const candidate =
      typeof inputMaxSteps === 'number' && Number.isFinite(inputMaxSteps)
        ? inputMaxSteps
        : configured;
    if (!candidate || !Number.isFinite(candidate)) {
      return 5;
    }
    return Math.min(12, Math.max(3, Math.floor(candidate)));
  }

  private resolveHintHopsPerAction(pathHintCount: number, maxSteps: number): number {
    const configured = parseOptionalNumber(process.env.CHAT_AUTOMATION_HINT_HOPS_PER_ACTION);
    if (configured && Number.isFinite(configured)) {
      return Math.min(6, Math.max(1, Math.floor(configured)));
    }
    const boundedHintCount = Math.max(1, Math.floor(pathHintCount));
    const boundedMaxSteps = Math.max(1, Math.floor(maxSteps));
    return Math.min(6, Math.min(boundedHintCount, boundedMaxSteps));
  }

  private buildHintObjective(
    objective: ActionObjective | undefined,
    hopHints: string[],
    isFinalHop: boolean,
    strictIntermediateHop: boolean
  ): ActionObjective | undefined {
    if (!objective && hopHints.length === 0) {
      return undefined;
    }

    const include = this.normalizeObjectiveTokens(
      [...hopHints, ...(isFinalHop ? objective?.includeAny ?? [] : [])],
      16
    );
    const avoid = this.normalizeObjectiveTokens(objective?.avoidAny, 16);
    const strict = isFinalHop ? Boolean(objective?.strict) : strictIntermediateHop;

    if (include.length === 0 && avoid.length === 0) {
      return undefined;
    }
    return {
      includeAny: include.length > 0 ? include : undefined,
      avoidAny: avoid.length > 0 ? avoid : undefined,
      strict
    };
  }

  private async expandNavigationSurface(hints: string[]): Promise<DriverLog[]> {
    const page = this.requirePage();
    const logs: DriverLog[] = [];
    const normalizedHints = hints
      .map((hint) => normalizeText(hint.toLowerCase()))
      .filter((hint) => hint.length > 0);
    if (normalizedHints.length === 0) {
      return logs;
    }
    const isRootIntent = normalizedHints.some((hint) => /(카테고리|category|메뉴|menu|전체)/i.test(hint));
    if (!isRootIntent) {
      return logs;
    }
    const specificHints = normalizedHints
      .filter((hint) => !/(카테고리|category|메뉴|menu|전체|navigation|nav|browse)/i.test(hint))
      .slice(0, 4);

    await this.clearCandidateMarkers();
    const candidates = await page.evaluate(({ specificHints }) => {
      const compactSpecificHints = specificHints.map((hint) => hint.replace(/[^a-z0-9가-힣]+/g, ''));
      const specificHintTokens = specificHints.map((hint) =>
        hint
          .split(/[^a-z0-9가-힣]+/g)
          .map((token) => token.trim())
          .filter((token) => token.length >= 2)
      );
      let serial = 0;
      const rows: Array<{ selector: string; text: string; score: number }> = [];
      const elements = Array.from(
        document.querySelectorAll('button, [role="button"], summary, a[href], [aria-expanded]')
      ) as HTMLElement[];
      for (const element of elements) {
        const rect = element.getBoundingClientRect();
        if (rect.width <= 2 || rect.height <= 2) {
          continue;
        }
        if (rect.bottom < 0 || rect.top > window.innerHeight * 0.75) {
          continue;
        }
        const text = (element.textContent ?? '').replace(/\s+/g, ' ').trim();
        const descriptor = [
          element.getAttribute('aria-label') ?? '',
          element.getAttribute('class') ?? '',
          element.getAttribute('id') ?? '',
          element.getAttribute('data-role') ?? '',
          element.getAttribute('aria-expanded') ?? ''
        ]
          .join(' ')
          .toLowerCase();
        const signal = `${text.toLowerCase()} ${descriptor}`;
        const hasCategorySignal = /(카테고리|category|메뉴|menu|hamburger|navigation|nav|browse|☰)/i.test(signal);
        const hasAllSignal = /전체/.test(signal);
        const destructiveSignal = /(삭제|clear|reset|remove|close|dismiss|취소|초기화)/i.test(signal);
        const utilitySignal = /(최근\s*본|최근본|찜|장바구니|관심상품|주문내역|구매내역|서비스\s*더보기|전체\s*서비스|more\s*services?)/i.test(
          signal
        );
        const inNavigationContainer = Boolean(
          element.closest(
            'header, nav, [role="navigation"], .gnb, .lnb, [class*="menu"], [class*="cate"], [class*="nav"]'
          )
        );
        if (destructiveSignal || utilitySignal) {
          continue;
        }
        if (!hasCategorySignal && !(hasAllSignal && inNavigationContainer)) {
          continue;
        }
        if (!inNavigationContainer && !hasCategorySignal) {
          continue;
        }
        const tag = element.tagName.toLowerCase();
        const href = tag === 'a' ? (element.getAttribute('href') ?? '').trim().toLowerCase() : '';
        const anchorToggle = href === '#' || href.endsWith('/#') || href.startsWith('javascript:');
        if (tag === 'a' && !anchorToggle) {
          continue;
        }
        if (/(ai|뉴스|news|블로그|blog|리뷰|review|가이드|guide|공지|notice|faq|help|문의|event|promo)/i.test(signal)) {
          continue;
        }

        let score = 0.2;
        if (/aria-expanded\s*[:=]?\s*(false|0)|\"false\"/.test(signal)) {
          score += 0.5;
        }
        if (inNavigationContainer) {
          score += 0.38;
        }
        if (rect.top <= window.innerHeight * 0.3) {
          score += 0.25;
        }
        if (hasCategorySignal) {
          score += 0.35;
        }
        if (hasAllSignal && inNavigationContainer) {
          score += 0.12;
        }
        if (specificHints.length > 0) {
          const compactSignal = signal.replace(/[^a-z0-9가-힣]+/g, '');
          const specificMatched = specificHints.filter((hint, index) => {
            const compactHint = compactSpecificHints[index] ?? '';
            const tokens = specificHintTokens[index] ?? [];
            const tokenMatched = tokens.some((token) => signal.includes(token));
            return (
              signal.includes(hint) ||
              tokenMatched ||
              (compactHint.length >= 2 && compactSignal.includes(compactHint))
            );
          }).length;
          if (specificMatched > 0) {
            score += Math.min(0.45, 0.18 * specificMatched);
          } else if (!hasCategorySignal) {
            score -= 0.35;
          }
        }
        if (score < 0.5) {
          continue;
        }

        serial += 1;
        const id = `wa-nav-open-${serial}`;
        element.setAttribute('data-wa-nav-open-id', id);
        rows.push({
          selector: `[data-wa-nav-open-id="${id}"]`,
          text: text || (element.getAttribute('aria-label') ?? ''),
          score
        });
      }
      rows.sort((left, right) => right.score - left.score);
      return rows.slice(0, 4);
    }, { specificHints });

    let preOpenApplied = false;
    for (const candidate of candidates) {
      const locator = page.locator(candidate.selector).first();
      const visible = await ignore(locator.isVisible({ timeout: 1200 }));
      if (!visible) {
        continue;
      }
      const interactable = await this.isLocatorInteractable(locator);
      if (!interactable) {
        continue;
      }
      try {
        await locator.hover({ timeout: 2500 });
        await ignore(page.waitForTimeout(160));
        preOpenApplied = true;
        logs.push({
          level: 'info',
          message: `Hint navigation pre-open: text=${candidate.text || 'n/a'} mode=hover`
        });
      } catch (error) {
        if (!isRecoverableClickError(error)) {
          throw error;
        }
      }

      if (!preOpenApplied) {
        continue;
      }
      if (specificHints.length > 0) {
        const hoverFollowupReady = await this.hasFollowupNavigationCandidates(specificHints.slice(0, 2));
        if (hoverFollowupReady) {
          logs.push({
            level: 'info',
            message: `Hint navigation pre-open lock acquired: text=${candidate.text || 'n/a'} followupHints=[${specificHints.slice(0, 2).join(', ')}]`
          });
          break;
        }
      }

      const hrefRaw = ((await ignore(locator.getAttribute('href'))) ?? '').trim().toLowerCase();
      const ariaExpanded = ((await ignore(locator.getAttribute('aria-expanded'))) ?? '').trim().toLowerCase();
      const anchorToggle = hrefRaw === '' || hrefRaw === '#' || hrefRaw.endsWith('/#') || hrefRaw.startsWith('javascript:');
      const toggleControl = ariaExpanded === 'false' || ariaExpanded === '0' || anchorToggle;
      const shouldClickToggle =
        toggleControl &&
        (/button|summary/i.test(candidate.selector) ||
          /카테고리|category|menu|메뉴/.test((candidate.text ?? '').toLowerCase()));
      if (!shouldClickToggle) {
        continue;
      }
      try {
        await locator.click({ timeout: 2600 });
        await ignore(page.waitForTimeout(30));
        preOpenApplied = true;
        logs.push({
          level: 'info',
          message: `Hint navigation pre-open: text=${candidate.text || 'n/a'} mode=click`
        });
      } catch (error) {
        if (!isRecoverableClickError(error)) {
          throw error;
        }
      }

      if (specificHints.length === 0) {
        break;
      }
      const followupReady = await this.hasFollowupNavigationCandidates(specificHints.slice(0, 2));
      if (followupReady) {
        logs.push({
          level: 'info',
          message: `Hint navigation pre-open lock acquired: text=${candidate.text || 'n/a'} followupHints=[${specificHints.slice(0, 2).join(', ')}]`
        });
        break;
      }
    }

    await ignore(
      page.evaluate(() => {
        for (const node of Array.from(document.querySelectorAll('[data-wa-nav-open-id]'))) {
          node.removeAttribute('data-wa-nav-open-id');
        }
      })
    );
    return logs;
  }

  private isWeakTransition(beforeUrl: string, afterUrl: string, hrefRaw: string | undefined): boolean {
    const beforeNoHash = stripHash(beforeUrl);
    const afterNoHash = stripHash(afterUrl);
    const href = (hrefRaw ?? '').trim();
    if (!href) {
      return true;
    }
    const lowered = href.toLowerCase();
    if (lowered.startsWith('javascript:') || lowered === '#' || lowered.endsWith('/#')) {
      return true;
    }
    if (beforeNoHash !== afterNoHash) {
      return false;
    }
    try {
      const parsedBefore = new URL(beforeUrl);
      const parsedHref = new URL(href, beforeUrl);
      if (
        parsedHref.origin === parsedBefore.origin &&
        parsedHref.pathname === parsedBefore.pathname &&
        parsedHref.search === parsedBefore.search
      ) {
        return true;
      }
      if (
        parsedHref.origin === parsedBefore.origin &&
        parsedHref.pathname === '/' &&
        parsedBefore.pathname === '/' &&
        parsedHref.search.length === 0
      ) {
        return true;
      }
    } catch {
      return true;
    }
    return false;
  }

  private async recoverFromWeakTransition(input: {
    beforeUrl: string;
    hints: string[];
    objective: ActionObjective | undefined;
    label: string;
  }): Promise<{ recovered: boolean; logs: DriverLog[]; clickedText?: string; clickedHref?: string }> {
    const page = this.requirePage();
    const logs: DriverLog[] = [];
    const currentUrl = page.url();
    const currentHost = (() => {
      try {
        return new URL(currentUrl).hostname.toLowerCase();
      } catch {
        return '';
      }
    })();
    await ignore(page.waitForTimeout(280));

    const rawCandidates = await this.collectClickableCandidates(input.hints, {
      label: `${input.label}-weak-recovery`,
      rootHintMode: false,
      wantsSearch: false,
      wantsFilter: false
    });
    const ranked = await this.rankCandidatesByContext(rawCandidates, {
      hints: input.hints,
      label: `${input.label}-weak-recovery`,
      intent: 'navigation',
      forceSemantic: true
    });

    for (const candidate of ranked.candidates.slice(0, 8)) {
      const href = (candidate.href ?? '').trim();
      if (!href || this.isWeakTransition(input.beforeUrl, input.beforeUrl, href)) {
        continue;
      }
      if (this.isLikelyProductOrAdCandidate(candidate)) {
        continue;
      }
      if (looksPromotionLike(href)) {
        continue;
      }
      if (!sameAllowedRoot(href, this.allowedRootDomain)) {
        continue;
      }
      try {
        const parsed = new URL(href, currentUrl);
        if (parsed.hostname.toLowerCase() !== currentHost) {
          continue;
        }
      } catch {
        continue;
      }
      const objectiveCheck = this.candidateMatchesObjective(candidate, input.objective);
      if (!objectiveCheck.ok) {
        continue;
      }

      const locator = page.locator(candidate.selector).first();
      const visible = await ignore(locator.isVisible({ timeout: 1200 }));
      if (!visible) {
        continue;
      }
      const interactable = await this.isLocatorInteractable(locator);
      if (!interactable) {
        continue;
      }

      const clickBefore = page.url();
      try {
        await locator.click({ timeout: 2200 });
      } catch (error) {
        if (!isRecoverableClickError(error)) {
          throw error;
        }
        continue;
      }
      await ignore(page.waitForLoadState('domcontentloaded', { timeout: 15000 }));
      await ignore(page.waitForTimeout(320));
      const clickAfter = page.url();
      const afterTitle = (await ignore(page.title())) ?? '';

      if (!sameAllowedRoot(clickAfter, this.allowedRootDomain)) {
        await ignore(page.goBack({ waitUntil: 'domcontentloaded', timeout: 12_000 }));
        await ignore(page.waitForTimeout(280));
        continue;
      }
      if (looksPromotionLike(clickAfter, afterTitle)) {
        await ignore(page.goBack({ waitUntil: 'domcontentloaded', timeout: 12_000 }));
        await ignore(page.waitForTimeout(280));
        continue;
      }

      const pageObjective = await this.pageMatchesObjective(input.objective);
      const progressed = stripHash(clickAfter) !== stripHash(clickBefore);
      if (!progressed && !pageObjective.ok) {
        await ignore(page.goBack({ waitUntil: 'domcontentloaded', timeout: 12_000 }));
        await ignore(page.waitForTimeout(280));
        continue;
      }

      logs.push({
        level: 'info',
        message: `Weak navigation recovery succeeded: label=${input.label} strategy=${ranked.metadata?.strategy ?? 'structure_first'} backend=${ranked.metadata?.vectorBackend ?? 'n/a'} text=${candidate.text || 'n/a'} href=${candidate.href ?? 'n/a'}`
      });
      return {
        recovered: true,
        logs,
        clickedText: candidate.text || undefined,
        clickedHref: candidate.href
      };
    }

    logs.push({
      level: 'warn',
      message: `Weak navigation recovery failed: label=${input.label} hints=[${input.hints.join(', ')}]`
    });
    return { recovered: false, logs };
  }

  private inferCandidateIntent(hints: string[], label: string): CandidateIntent {
    const joined = `${hints.join(' ')} ${label}`.toLowerCase();
    if (/(menu|메뉴|카테고리|category|navigation|nav|전체메뉴)/i.test(joined)) {
      return 'menu';
    }
    if (/(login|로그인|sign in|signin|인증)/i.test(joined)) {
      return 'login';
    }
    if (/(search|검색|query|찾기)/i.test(joined)) {
      return 'search';
    }
    if (/(setting|설정|preferences|profile|계정)/i.test(joined)) {
      return 'settings';
    }
    if (/(navigation|네비|header|헤더|상단)/i.test(joined)) {
      return 'navigation';
    }
    return 'generic';
  }

  private normalizeObjectiveTokens(tokens: string[] | undefined, limit: number): string[] {
    if (!tokens || tokens.length === 0) {
      return [];
    }
    const seen = new Set<string>();
    const normalized: string[] = [];
    for (const token of tokens) {
      const value = normalizeText(token).toLowerCase();
      if (!value || value.length < 2 || seen.has(value)) {
        continue;
      }
      seen.add(value);
      normalized.push(value);
      if (normalized.length >= limit) {
        break;
      }
    }
    return normalized;
  }

  private candidateEvidenceText(candidate: DomActionCandidate): string {
    const attributes = candidate.attributes ?? {};
    const chunks = [
      candidate.text,
      candidate.role,
      attributes.class,
      attributes.id,
      attributes['aria-label'],
      attributes.nearbyText,
      attributes.region,
      attributes.href,
      candidate.href
    ]
      .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
      .map((entry) => entry.toLowerCase());
    return chunks.join(' ');
  }

  private objectiveCheckFromText(
    text: string,
    objective: ActionObjective | undefined,
    options?: {
      hardAvoid?: boolean;
    }
  ): {
    ok: boolean;
    includeMatches: string[];
    avoidMatches: string[];
  } {
    if (!objective) {
      return {
        ok: true,
        includeMatches: [],
        avoidMatches: []
      };
    }
    const includeAny = this.normalizeObjectiveTokens(objective.includeAny, 20);
    const avoidAny = this.normalizeObjectiveTokens(objective.avoidAny, 20);
    if (includeAny.length === 0 && avoidAny.length === 0) {
      return {
        ok: true,
        includeMatches: [],
        avoidMatches: []
      };
    }
    const lowered = text.toLowerCase();
    const compact = normalizeComparableText(lowered);
    const hasToken = (token: string): boolean => {
      if (!token) {
        return false;
      }
      const compactToken = normalizeComparableText(token);
      if (compactToken.length >= 2 && compact.includes(compactToken)) {
        return true;
      }
      if (lowered.includes(token)) {
        return true;
      }
      const parts = token
        .split(/[^a-z0-9가-힣]+/g)
        .map((part) => part.trim())
        .filter((part) => part.length >= 2);
      return parts.some((part) => {
        const compactPart = normalizeComparableText(part);
        return lowered.includes(part) || (compactPart.length >= 2 && compact.includes(compactPart));
      });
    };
    const includeMatches = includeAny.filter((token) => hasToken(token));
    const avoidMatches = avoidAny.filter((token) => hasToken(token));
    const strict = Boolean(objective.strict);
    const includeSatisfied = includeAny.length === 0 || includeMatches.length > 0;
    const hardAvoidMatched = options?.hardAvoid === true && avoidMatches.length > 0;
    const avoidSafe =
      !hardAvoidMatched && (avoidMatches.length === 0 || includeMatches.length > 0);
    return {
      ok: (strict ? includeSatisfied : true) && avoidSafe,
      includeMatches,
      avoidMatches
    };
  }

  private candidateMatchesObjective(
    candidate: DomActionCandidate,
    objective: ActionObjective | undefined
  ): {
    ok: boolean;
    includeMatches: string[];
    avoidMatches: string[];
  } {
    const text = this.candidateEvidenceText(candidate);
    return this.objectiveCheckFromText(text, objective, {
      hardAvoid: true
    });
  }

  private async pageMatchesObjective(
    objective: ActionObjective | undefined
  ): Promise<{
    ok: boolean;
    includeMatches: string[];
    avoidMatches: string[];
    signal: string;
  }> {
    if (!objective) {
      return {
        ok: true,
        includeMatches: [],
        avoidMatches: [],
        signal: ''
      };
    }
    const page = this.requirePage();
    const title = (await ignore(page.title())) ?? '';
    const url = page.url();
    const snapshot =
      (await ignore(
        page.evaluate(() => {
          const chunks: string[] = [];
          const headingNodes = Array.from(
            document.querySelectorAll('h1, h2, h3, [class*="breadcrumb"], [class*="category"], [class*="cate"]')
          );
          for (const node of headingNodes.slice(0, 20)) {
            const text = (node.textContent ?? '').replace(/\s+/g, ' ').trim();
            if (text) {
              chunks.push(text);
            }
          }
          const bodyText = (document.body?.innerText ?? '')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 1800);
          if (bodyText) {
            chunks.push(bodyText);
          }
          return chunks.join(' ');
        })
      )) ?? '';
    const signal = `${title} ${url} ${snapshot}`.trim();
    const checked = this.objectiveCheckFromText(signal, objective);
    return {
      ...checked,
      signal
    };
  }

  private async hasFollowupNavigationCandidates(hints: string[]): Promise<boolean> {
    const page = this.requirePage();
    const cleaned = hints
      .map((hint) => normalizeText(hint))
      .filter((hint, index, list) => hint.length > 0 && list.indexOf(hint) === index)
      .slice(0, 4);
    if (cleaned.length === 0) {
      return false;
    }
    const evaluateCandidates = async (navigationOnly: boolean): Promise<boolean> =>
      page.evaluate(({ queryHints, navigationOnly }) => {
      const compactHints = queryHints.map((hint) => hint.toLowerCase().replace(/[^a-z0-9가-힣]+/g, ''));
      const hintTokens = queryHints.map((hint) =>
        hint
          .toLowerCase()
          .split(/[^a-z0-9가-힣]+/g)
          .map((token) => token.trim())
          .filter((token) => token.length >= 2)
      );
      const nodes = Array.from(
        document.querySelectorAll('a[href], button, [role="button"], summary, [aria-expanded]')
      ) as HTMLElement[];
      for (const node of nodes) {
        const rect = node.getBoundingClientRect();
        if (rect.width <= 2 || rect.height <= 2) {
          continue;
        }
        if (rect.bottom < -120 || rect.top > window.innerHeight + 1200) {
          continue;
        }
        const style = window.getComputedStyle(node);
        if (style.display === 'none' || style.visibility === 'hidden' || style.pointerEvents === 'none') {
          continue;
        }
        if (navigationOnly) {
          const inNavigationContainer = Boolean(
            node.closest(
              'nav, header, [role="navigation"], [role="menu"], [role="menubar"], .gnb, .lnb, [class*="menu"], [class*="cate"], [class*="nav"], [class*="submenu"], [class*="dropdown"], [class*="flyout"], [class*="layer"], [class*="popover"], [id*="menu"], [id*="cate"], [id*="nav"]'
            )
          );
          if (!inNavigationContainer) {
            continue;
          }
        }
        const text = (node.textContent ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
        const descriptor = [
          node.getAttribute('aria-label') ?? '',
          node.getAttribute('class') ?? '',
          node.getAttribute('id') ?? ''
        ]
          .join(' ')
          .toLowerCase();
        const compactText = text.toLowerCase().replace(/[^a-z0-9가-힣]+/g, '');
        const compactDescriptor = descriptor.toLowerCase().replace(/[^a-z0-9가-힣]+/g, '');
        const matched = queryHints.some((hint, index) => {
          const compactHint = compactHints[index] ?? '';
          const tokens = hintTokens[index] ?? [];
          const tokenMatched = tokens.some((token) =>
            text.includes(token) ||
            descriptor.includes(token) ||
            compactText.includes(token) ||
            compactDescriptor.includes(token)
          );
          return (
            text.includes(hint) ||
            descriptor.includes(hint) ||
            tokenMatched ||
            (compactHint.length >= 2 &&
              (compactText.includes(compactHint) || compactDescriptor.includes(compactHint)))
          );
        });
        if (matched) {
          return true;
        }
      }
      return false;
      }, { queryHints: cleaned, navigationOnly });
    const strictMatched = await evaluateCandidates(true);
    if (strictMatched) {
      return true;
    }
    return evaluateCandidates(false);
  }

  private isNavigationScopeCandidate(candidate: DomActionCandidate): boolean {
    const attrs = candidate.attributes ?? {};
    const role = (candidate.role ?? '').toLowerCase();
    const region = (attrs.region ?? '').toLowerCase();
    const navEvidence = [
      candidate.text ?? '',
      role,
      attrs.class ?? '',
      attrs.id ?? '',
      attrs['aria-label'] ?? '',
      attrs['aria-expanded'] ?? '',
      attrs.nearbyText ?? '',
      region
    ]
      .join(' ')
      .toLowerCase();
    const productEvidence = [
      candidate.text ?? '',
      attrs.class ?? '',
      attrs.id ?? '',
      attrs.nearbyText ?? '',
      attrs.href ?? '',
      candidate.href ?? ''
    ]
      .join(' ')
      .toLowerCase();
    const navSignal =
      role === 'menuitem' ||
      /(navigation|menu|category|gnb|lnb|header|nav|카테고리|메뉴|분류|탐색)/i.test(navEvidence) ||
      /^(header|nav|navigation)$/i.test(region);
    if (!navSignal) {
      return false;
    }
    const productSignal =
      /(product|goods|item|model|가격|원|할인|구매|장바구니|리뷰|후기|광고|promo|bridge|loadingbridge|powershopping|adkeyword|pcode|goodsno|prodno)/i.test(
        productEvidence
      ) || this.isLikelyProductLikeText(candidate.text ?? '');
    return !productSignal;
  }

  private isLikelyProductLikeText(text: string): boolean {
    const normalized = normalizeText(text).toLowerCase();
    if (!normalized) {
      return false;
    }
    if (normalized.length >= 34 && /[0-9]{2,}|[()[\]]/.test(normalized)) {
      return true;
    }
    if (normalized.length >= 18 && /[a-z]{2,}.*\d{3,}/i.test(normalized)) {
      return true;
    }
    if (normalized.length >= 20 && /(?:[a-z]{2,}\s*){2,}/i.test(normalized) && /[0-9]/.test(normalized)) {
      return true;
    }
    return /(무료배송|즉시할인|특가|모델|상품|구매|후기|리뷰|원\b|만원|쿠폰|브랜드|power shopping)/i.test(normalized);
  }

  private isLikelyProductOrAdCandidate(candidate: DomActionCandidate): boolean {
    const href = (candidate.href ?? candidate.attributes?.href ?? '').toLowerCase();
    const text = candidate.text ?? '';
    if (href.length > 0) {
      if (/loadingbridge|bridge\/|powershopping|adkeyword|affiliate|outlink|pcode=|goodsno=|prodno=|productno=/i.test(href)) {
        return true;
      }
      if (/\/(?:product|item|goods|model)\b/i.test(href)) {
        return true;
      }
    }
    return this.isLikelyProductLikeText(text);
  }

  private isLikelyFilterControlCandidate(candidate: DomActionCandidate): boolean {
    const evidence = this.candidateEvidenceText(candidate);
    const filterSignal =
      /(필터|filter|조건|facet|refine|정렬|sort|가격|price|budget|예산|상한|최대|최소|color|컬러|색상|옵션|option)/i.test(
        evidence
      );
    const productSignal =
      /(prod_item|product|goods|item_list|상품|무료배송|할인|즉시할인|coupon|쿠폰|model|review|리뷰|후기|loadingbridge|powershopping|adkeyword|pcode=|goodsno=|prodno=)/i.test(
        evidence
      );
    if (filterSignal) {
      return true;
    }
    if (productSignal) {
      return false;
    }
    return /(^| )button( |$)|form|aside|dialog/.test(evidence);
  }

  private prioritizeNavigationScopeCandidates(
    candidates: DomActionCandidate[],
    navigationOnly: boolean
  ): { ordered: DomActionCandidate[]; scopedCount: number } {
    if (!navigationOnly || candidates.length <= 1) {
      return { ordered: candidates, scopedCount: 0 };
    }
    const scoped = candidates.filter((candidate) => this.isNavigationScopeCandidate(candidate));
    if (scoped.length === 0) {
      return { ordered: candidates, scopedCount: 0 };
    }
    const scopedIds = new Set(scoped.map((candidate) => candidate.id));
    const ordered = [...scoped, ...candidates.filter((candidate) => !scopedIds.has(candidate.id))];
    return { ordered, scopedCount: scoped.length };
  }

  private async rankCandidatesByContext(
    candidates: DomActionCandidate[],
    input: {
      hints: string[];
      label: string;
      intent?: CandidateIntent;
      forceSemantic?: boolean;
    }
  ): Promise<RankedCandidateSet> {
    if (candidates.length === 0) {
      return { candidates: [] };
    }

    const maxCandidates = this.candidateMaxSelected();
    const structureFirstLimit = this.candidateStructureFirstLimit();
    const normalizedHints = input.hints
      .map((hint) => normalizeText(hint))
      .filter((hint) => hint.length > 0)
      .slice(0, 8);
    const query = normalizedHints.join(' ').trim();
    const intent = input.intent ?? this.inferCandidateIntent(normalizedHints, input.label);
    const candidateItems: CandidateItem[] = candidates.map((candidate) => ({
      id: candidate.id,
      role: candidate.role,
      text: candidate.text,
      score: candidate.score,
      bbox: candidate.bbox,
      attributes: candidate.attributes
    }));
    const candidateById = new Map(candidates.map((candidate) => [candidate.id, candidate]));

    const semanticAllowed =
      this.semanticRerankEnabled() &&
      query.length > 0 &&
      (input.forceSemantic === true || candidates.length >= this.semanticRerankMinCandidates());

    if (!semanticAllowed) {
      const context = buildCandidateContext(candidateItems, {
        maxCandidates,
        structureFirstLimit,
        intent,
        query: query.length > 0 ? query : undefined
      });
      const ordered = context.candidates
        .map((candidate) => candidateById.get(candidate.id))
        .filter((candidate): candidate is DomActionCandidate => Boolean(candidate));
      return {
        candidates: ordered,
        metadata: {
          strategy: context.metadata?.strategy ?? 'structure_first',
          structureFirstPoolSize: context.metadata?.structureFirstPoolSize,
          returnedCandidates: context.metadata?.returnedCandidates
        }
      };
    }

    const context = await buildCandidateContextWithSemanticRerank(candidateItems, {
      maxCandidates,
      structureFirstLimit,
      intent,
      query,
      semanticRerank: {
        query,
        pageKey: this.currentPageKey(),
        cache: this.candidateEmbeddingCache,
        vectorBackend: this.candidateVectorBackend(),
        topK: maxCandidates,
        embed: async (texts) =>
          embedTextsLocally(texts, {
            dimensions: 192
          })
      }
    });

    const ordered = context.candidates
      .map((candidate) => candidateById.get(candidate.id))
      .filter((candidate): candidate is DomActionCandidate => Boolean(candidate));
    return {
      candidates: ordered,
      metadata: {
        strategy: context.metadata?.strategy ?? 'structure_plus_semantic',
        vectorBackend: context.metadata?.vectorBackend,
        structureFirstPoolSize: context.metadata?.structureFirstPoolSize,
        returnedCandidates: context.metadata?.returnedCandidates,
        embeddedCandidateCount: context.metadata?.embeddedCandidateCount
      }
    };
  }

  async start(): Promise<DriverLog[]> {
    const logs: DriverLog[] = [];
    const { chromium } = await import('playwright');
    const desiredHeadless = this.options.browserMode === 'headless';
    let actualHeadless = desiredHeadless;

    try {
      this.browser = await chromium.launch({
        headless: desiredHeadless
      });
    } catch (error) {
      if (desiredHeadless) {
        throw error;
      }
      actualHeadless = true;
      this.browser = await chromium.launch({
        headless: true
      });
      const reason =
        error instanceof Error
          ? error.message.split('\n').map((row) => row.trim()).filter((row) => row.length > 0)[0]
          : String(error);
      logs.push({
        level: 'warn',
        message: `Headful launch failed in current environment (${reason}). Fallback to headless was applied.`
      });
    }

    this.context = await this.browser.newContext({
      locale: 'ko-KR',
      timezoneId: 'Asia/Seoul'
    });
    this.page = await this.context.newPage();

    const root = this.options.screenshotRoot
      ? resolve(this.options.screenshotRoot)
      : resolve(tmpdir(), 'web-agentic-chat-runtime');
    this.screenshotDir = join(
      root,
      sanitizePathPart(this.options.sessionId),
      sanitizePathPart(this.options.runId)
    );
    await mkdir(this.screenshotDir, { recursive: true });

    logs.push({
      level: 'info',
      message: `Browser runtime initialized (${actualHeadless ? 'headless' : 'headful'})`
    });
    return logs;
  }

  async navigate(url: string): Promise<DriverLog[]> {
    const page = this.requirePage();
    if (!this.allowedRootDomain) {
      this.allowedRootDomain = resolveRegistrableDomainFromUrl(url);
    }
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });
    return [
      {
        level: 'info',
        message: `Action navigate: ${url}`
      }
    ];
  }

  private async clearCandidateMarkers(): Promise<void> {
    const page = this.requirePage();
    await ignore(
      page.evaluate(() => {
        const markers = Array.from(document.querySelectorAll('[data-wa-candidate-id], [data-wa-input-id]'));
        for (const marker of markers) {
          marker.removeAttribute('data-wa-candidate-id');
          marker.removeAttribute('data-wa-input-id');
        }
      })
    );
  }

  private async isLocatorInteractable(locator: Locator): Promise<boolean> {
    const interactable = await ignore(
      locator.evaluate((node) => {
        if (!(node instanceof HTMLElement)) {
          return false;
        }
        const rect = node.getBoundingClientRect();
        if (rect.width <= 2 || rect.height <= 2) {
          return false;
        }
        if (rect.bottom <= 1 || rect.right <= 1 || rect.top >= window.innerHeight - 1 || rect.left >= window.innerWidth - 1) {
          return false;
        }
        const cx = Math.min(window.innerWidth - 1, Math.max(1, rect.left + rect.width / 2));
        const cy = Math.min(window.innerHeight - 1, Math.max(1, rect.top + rect.height / 2));
        const topNode = document.elementFromPoint(cx, cy);
        if (!topNode) {
          return false;
        }
        return topNode === node || node.contains(topNode) || (topNode instanceof HTMLElement && topNode.contains(node));
      })
    );
    return interactable === true;
  }

  private async collectClickableCandidates(
    hints: string[],
    options: {
      label: string;
      rootHintMode: boolean;
      wantsSearch: boolean;
      wantsFilter: boolean;
      allowLooseNavigationMatch?: boolean;
    }
  ): Promise<DomActionCandidate[]> {
    const page = this.requirePage();
    await this.clearCandidateMarkers();
    const normalizedHints = hints
      .map((hint) => normalizeText(hint.toLowerCase()))
      .filter((hint) => hint.length > 0);
    const navigationMode = !options.wantsSearch && !options.wantsFilter;
    const effectiveHints = navigationMode
      ? this.expandNavigationHints(normalizedHints)
      : normalizedHints;
    const rows = await page.evaluate(
      ({ hints, allowedRoot, options }) => {
        const compactHints = hints.map((hint) => hint.toLowerCase().replace(/[^a-z0-9가-힣]+/g, ''));
        const hintTokens = hints.map((hint) =>
          hint
            .toLowerCase()
            .split(/[^a-z0-9가-힣]+/g)
            .map((token) => token.trim())
            .filter((token) => token.length >= 2)
        );
        const currentHost = window.location.hostname.toLowerCase();
        const currentHostLabels = currentHost
          .toLowerCase()
          .replace(/\.$/, '')
          .split('.')
          .filter((row) => row.length > 0);
        const currentRoot =
          currentHostLabels.length < 2
            ? currentHost
            : currentHostLabels.slice(-2).join('.');
        let serial = 0;
        const candidates: Array<{
          id: string;
          selector: string;
          role: string;
          text: string;
          score: number;
          bbox: [number, number, number, number];
          attributes: Record<string, string>;
          href?: string;
        }> = [];

        const elements = Array.from(
          document.querySelectorAll('a[href], button, [role="button"], summary, [onclick], [aria-expanded]')
        ) as HTMLElement[];

        for (const element of elements) {
          const text = (element.textContent ?? '').replace(/\s+/g, ' ').trim();
          const descriptor = [
            element.getAttribute('id') ?? '',
            element.getAttribute('class') ?? '',
            element.getAttribute('role') ?? '',
            element.getAttribute('aria-label') ?? '',
            element.getAttribute('data-role') ?? ''
          ]
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase();
          const textAndDescriptor = `${text.toLowerCase()} ${descriptor}`;
          const filterKeywordMatched = /(필터|filter|조건|색상|컬러|color|정렬|sort|가격|price|예산|budget|옵션|option)/i.test(
            textAndDescriptor
          );
          const tagName = element.tagName.toLowerCase();
          const roleAttr = (element.getAttribute('role') ?? '').toLowerCase();
          const filterContextMatched = Boolean(
            element.closest(
              '[class*="filter"], [id*="filter"], [class*="sort"], [id*="sort"], [class*="facet"], [id*="facet"], [class*="refine"], [id*="refine"], [class*="price"], [id*="price"], [aria-label*="필터"], [aria-label*="filter"], [role="dialog"], aside, form'
            )
          );
          const inProductContainer = Boolean(
            element.closest('.prod_item, .product, .goods, .item_list, [class*="prod_item"], [class*="product"], [class*="goods"]')
          );
          const filterControlLike =
            tagName === 'button' ||
            roleAttr === 'button' ||
            /filter|sort|facet|refine|chip|option|accordion|toggle|price|budget/i.test(descriptor);
          const productLikeTextMatched = /(\d{1,3}(?:,\d{3})+\s*원|할인율|특가|무료배송|즉시할인|쿠폰|model\s*info|상품보기|상세보기)/i.test(
            textAndDescriptor
          );
          const normalizedText = text.toLowerCase();
          const rootKeywordMatched = /(카테고리|category|메뉴|navigation|nav|전체)/i.test(`${normalizedText} ${descriptor}`);
          const navigationNoiseMatched = /(ai|뉴스|news|블로그|blog|리뷰|review|가이드|guide|공지|notice|community|faq|help|문의|스토리|story|magazine|event|promo)/i.test(
            `${normalizedText} ${descriptor}`
          );
          const hasNavigationContainer = Boolean(
            element.closest('nav, header, [role="navigation"], .menu, .category, .gnb, .lnb, [class*="menu"], [class*="cate"], [class*="nav"], [class*="submenu"], [class*="dropdown"], [class*="flyout"], [class*="layer"], [class*="popover"], [id*="menu"], [id*="cate"], [id*="nav"]')
          );
          if (!text && descriptor.length === 0) {
            continue;
          }

          const rect = element.getBoundingClientRect();
          if (rect.width <= 2 || rect.height <= 2) {
            continue;
          }
          if (rect.bottom < 0 || rect.top > window.innerHeight + 1600) {
            continue;
          }

          const compactText = normalizedText.toLowerCase().replace(/[^a-z0-9가-힣]+/g, '');
          const compactDescriptor = descriptor.toLowerCase().replace(/[^a-z0-9가-힣]+/g, '');
          const matched =
            hints.length > 0
              ? hints.filter((hint, index) => {
                  const compactHint = compactHints[index] ?? '';
                  const tokens = hintTokens[index] ?? [];
                  const tokenMatched = tokens.some((token) =>
                    normalizedText.includes(token) ||
                    descriptor.includes(token) ||
                    compactText.includes(token) ||
                    compactDescriptor.includes(token)
                  );
                  return (
                    normalizedText.includes(hint) ||
                    descriptor.includes(hint) ||
                    tokenMatched ||
                    (compactHint.length >= 2 &&
                      (compactText.includes(compactHint) || compactDescriptor.includes(compactHint)))
                  );
                }).length
              : 0;
          const navigationMode = !options.wantsSearch && !options.wantsFilter;
          const allowLooseNavigationMatch =
            Boolean(options.allowLooseNavigationMatch) &&
            navigationMode &&
            !options.rootHintMode &&
            hasNavigationContainer &&
            !navigationNoiseMatched &&
            !inProductContainer &&
            normalizedText.length > 0;
          if (hints.length > 0 && matched === 0 && !allowLooseNavigationMatch) {
            continue;
          }

          const hrefRaw = (element as HTMLAnchorElement).href || '';
          const href = hrefRaw.trim().length > 0 ? hrefRaw.trim() : undefined;
          const targetBlank = ((element as HTMLAnchorElement).target ?? '').toLowerCase() === '_blank';
          const productLikeHrefMatched = /\/(?:products?|item|goods|model|auto|prd)\b|(?:^|[?&])(pcode|model|prdno|productno|goodsno)=/i.test(
            hrefRaw
          );
          let score = hints.length > 0 ? matched / Math.max(1, hints.length) : 0.2;

          if (element.closest('nav, header, [role="navigation"], .menu, .category, .gnb, .lnb')) {
            score += 0.28;
          }
          if (allowLooseNavigationMatch && matched === 0) {
            score += 0.12;
          }
          if (options.rootHintMode && !hasNavigationContainer) {
            score -= 0.9;
          }
          if (rect.top >= 0 && rect.top <= window.innerHeight * 0.58) {
            score += 0.14;
          }
          if (options.wantsSearch && /(검색|search|query)/i.test(`${normalizedText} ${descriptor}`)) {
            score += 0.42;
          }
          if (options.wantsFilter && /(필터|조건|색상|정렬|가격|옵션|filter|sort|price)/i.test(`${normalizedText} ${descriptor}`)) {
            score += 0.45;
          }
          if (options.wantsFilter && !filterKeywordMatched && !filterContextMatched) {
            continue;
          }
          if (
            options.wantsFilter &&
            !filterContextMatched &&
            (productLikeTextMatched || productLikeHrefMatched || inProductContainer)
          ) {
            continue;
          }
          if (options.wantsFilter && !filterContextMatched && !filterControlLike) {
            continue;
          }
          if (options.wantsFilter && tagName === 'a' && !filterContextMatched) {
            const hrefCandidate = hrefRaw.trim().toLowerCase();
            const anchorControlLike =
              hrefCandidate === '' ||
              hrefCandidate === '#' ||
              hrefCandidate.endsWith('/#') ||
              hrefCandidate.startsWith('javascript:');
            if (!anchorControlLike) {
              continue;
            }
          }
          if (options.rootHintMode && rootKeywordMatched) {
            score += 0.36;
          }
          if (options.rootHintMode && !rootKeywordMatched) {
            score -= 0.3;
          }
          if (options.rootHintMode && !rootKeywordMatched) {
            continue;
          }
          if (options.rootHintMode && navigationNoiseMatched) {
            continue;
          }
          if (/(카테고리|category|메뉴|navigation|nav|전체|스포츠|의류|패션|여성|남성|아웃도어|등산)/i.test(`${normalizedText} ${descriptor}`)) {
            score += 0.18;
          }
          if (options.rootHintMode && normalizedText.length > 40) {
            score -= 0.35;
          }
          if (!options.wantsSearch && !options.wantsFilter) {
            const navNoise = /(ai|뉴스|news|블로그|blog|리뷰|review|가이드|guide|공지|notice|community|faq|help|문의|스토리|story|magazine|event|promo)/i.test(
              `${normalizedText} ${descriptor} ${hrefRaw}`
            );
            const hintMatchedDirectly = hints.some((hint, index) => {
              const compactHint = compactHints[index] ?? '';
              const tokens = hintTokens[index] ?? [];
              const tokenMatched = tokens.some((token) =>
                normalizedText.includes(token) ||
                descriptor.includes(token) ||
                compactText.includes(token) ||
                compactDescriptor.includes(token)
              );
              return (
                normalizedText.includes(hint) ||
                descriptor.includes(hint) ||
                tokenMatched ||
                (compactHint.length >= 2 &&
                  (compactText.includes(compactHint) || compactDescriptor.includes(compactHint)))
              );
            });
            if (navNoise && !hintMatchedDirectly) {
              score -= options.rootHintMode ? 1.15 : 0.75;
            }
          }
          if (/바로가기|skip to|skip navigation|본문으로|content\s*skip/i.test(`${normalizedText} ${descriptor}`)) {
            score -= 1.4;
          }

          if (element.closest('.prod_item, .product, .goods, .item_list, [class*="prod_item"]')) {
            score -= options.wantsFilter ? 0.7 : 0.2;
          }
          if (!options.wantsSearch && !options.wantsFilter && (productLikeTextMatched || productLikeHrefMatched)) {
            if (!hasNavigationContainer && !rootKeywordMatched) {
              continue;
            }
            score -= 0.8;
          }
          if (targetBlank) {
            score -= 0.2;
          }

          if (href) {
            try {
              const parsed = new URL(href, window.location.href);
              const hrefHost = parsed.hostname.toLowerCase();
              const hrefHostLabels = hrefHost
                .toLowerCase()
                .replace(/\.$/, '')
                .split('.')
                .filter((row) => row.length > 0);
              const hrefRoot =
                hrefHostLabels.length < 2
                  ? hrefHost
                  : hrefHostLabels.slice(-2).join('.');
              const sameAllowedRoot =
                !allowedRoot || hrefHost === allowedRoot || hrefHost.endsWith(`.${allowedRoot}`);
              if (!sameAllowedRoot) {
                continue;
              }
              if (options.rootHintMode && hrefHost !== currentHost) {
                continue;
              }
              if (hrefHost === currentHost) {
                score += 0.15;
              } else if (hrefRoot === currentRoot) {
                score += 0.06;
              } else {
                score -= 0.55;
              }
              if (/bridge|go_link|redirect|affiliate|outlink/i.test(`${parsed.pathname}${parsed.search}`)) {
                score -= 0.7;
              }
              if (/\/(?:info|product|item|goods)\//i.test(parsed.pathname) || /(?:^|[?&])pcode=/i.test(parsed.search)) {
                score -= options.wantsFilter ? 0.9 : 0.4;
              }
              if (/plan|event|promo|guide|blog|news|review|magazine|story|community|help|faq|ai/i.test(`${hrefHost}${parsed.pathname}`)) {
                if (options.rootHintMode) {
                  continue;
                }
                score -= 0.45;
              }
            } catch {
              score -= 0.2;
            }
          }

          if (score < 0.35) {
            continue;
          }

          serial += 1;
          const id = `wa-candidate-${serial}`;
          element.setAttribute('data-wa-candidate-id', id);
          const tag = element.tagName.toLowerCase();
          const role = (element.getAttribute('role') ?? (tag === 'a' ? 'link' : tag === 'button' ? 'button' : tag)).toLowerCase();
          const nearbyText =
            (element.closest('section, article, nav, header, main, aside')?.querySelector('h1,h2,h3,h4,.title')?.textContent ?? '')
              .replace(/\s+/g, ' ')
              .trim();
          const region =
            (element.closest('nav, header, main, aside, footer, [role]')?.getAttribute('role') ??
              element.closest('nav, header, main, aside, footer')?.tagName ??
              '')
              .toLowerCase();

          candidates.push({
            id,
            selector: `[data-wa-candidate-id="${id}"]`,
            role,
            text: text || (element.getAttribute('aria-label') ?? ''),
            score,
            bbox: [rect.x, rect.y, rect.width, rect.height],
            attributes: {
              id: element.getAttribute('id') ?? '',
              class: element.getAttribute('class') ?? '',
              'aria-label': element.getAttribute('aria-label') ?? '',
              'aria-expanded': element.getAttribute('aria-expanded') ?? '',
              href: href ?? '',
              tag,
              region,
              nearbyText
            },
            href
          });
        }

        candidates.sort((left, right) => right.score - left.score);
        return candidates.slice(0, 220);
      },
      {
        hints: effectiveHints,
        allowedRoot: this.allowedRootDomain ?? null,
        options
      }
    );
    return rows.map((row) => ({
      ...row,
      score: Number.isFinite(row.score) ? row.score : 0
    }));
  }

  private async collectInputCandidates(hints: string[]): Promise<DomActionCandidate[]> {
    const page = this.requirePage();
    await this.clearCandidateMarkers();
    const normalizedHints = hints
      .map((hint) => normalizeText(hint.toLowerCase()))
      .filter((hint) => hint.length > 0);
    const rows = await page.evaluate((hints) => {
      let serial = 0;
      const candidates: Array<{
        id: string;
        selector: string;
        role: string;
        text: string;
        score: number;
        bbox: [number, number, number, number];
        attributes: Record<string, string>;
      }> = [];

      const elements = Array.from(document.querySelectorAll('input, textarea, [contenteditable="true"]')) as HTMLElement[];
      for (const element of elements) {
        const rect = element.getBoundingClientRect();
        if (rect.width <= 2 || rect.height <= 2) {
          continue;
        }
        if (rect.bottom < 0 || rect.top > window.innerHeight + 1400) {
          continue;
        }

        const tag = element.tagName.toLowerCase();
        const aria = (element.getAttribute('aria-label') ?? '').toLowerCase();
        const placeholder = (element.getAttribute('placeholder') ?? '').toLowerCase();
        const name = (element.getAttribute('name') ?? '').toLowerCase();
        const id = (element.getAttribute('id') ?? '').toLowerCase();
        const className = (element.getAttribute('class') ?? '').toLowerCase();
        const type = (element.getAttribute('type') ?? '').toLowerCase();
        const text = (element.textContent ?? '').replace(/\s+/g, ' ').trim();
        if (tag === 'input') {
          const input = element as HTMLInputElement;
          if (input.disabled || input.readOnly) {
            continue;
          }
          if (
            [
              'hidden',
              'checkbox',
              'radio',
              'file',
              'submit',
              'reset',
              'button',
              'image',
              'range',
              'color',
              'date',
              'datetime-local',
              'month',
              'time',
              'week'
            ].includes(type)
          ) {
            continue;
          }
        }

        let labelText = '';
        if (id) {
          labelText =
            (document.querySelector(`label[for="${CSS.escape(id)}"]`)?.textContent ?? '')
              .replace(/\s+/g, ' ')
              .trim()
              .toLowerCase();
        }
        const descriptor = `${aria} ${placeholder} ${name} ${id} ${className} ${labelText}`.trim();
        const matched = hints.length > 0 ? hints.filter((hint) => descriptor.includes(hint)).length : 0;
        if (hints.length > 0 && matched === 0) {
          continue;
        }
        let score = hints.length > 0 ? matched / Math.max(1, hints.length) : 0.2;
        if (/search|검색|query/.test(descriptor)) {
          score += 0.55;
        }
        if (/search|text/.test(type)) {
          score += 0.3;
        }
        if (tag === 'input' || tag === 'textarea') {
          score += 0.2;
        }
        if (score < 0.2) {
          continue;
        }

        serial += 1;
        const candidateId = `wa-input-${serial}`;
        element.setAttribute('data-wa-input-id', candidateId);
        candidates.push({
          id: candidateId,
          selector: `[data-wa-input-id="${candidateId}"]`,
          role: tag === 'input' || tag === 'textarea' ? 'textbox' : 'input',
          text: text || aria || placeholder || name,
          score,
          bbox: [rect.x, rect.y, rect.width, rect.height],
          attributes: {
            id: element.getAttribute('id') ?? '',
            class: element.getAttribute('class') ?? '',
            'aria-label': element.getAttribute('aria-label') ?? '',
            placeholder: element.getAttribute('placeholder') ?? '',
            type: element.getAttribute('type') ?? '',
            tag
          }
        });
      }

      candidates.sort((left, right) => right.score - left.score);
      return candidates.slice(0, 220);
    }, normalizedHints);
    return rows.map((row) => ({
      ...row,
      score: Number.isFinite(row.score) ? row.score : 0
    }));
  }

  private extractBudgetFillValue(raw: string): string {
    const digits = raw.replace(/[^\d]/g, '');
    if (digits.length === 0) {
      return raw;
    }
    const parsed = Number(digits);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return raw;
    }
    return String(Math.floor(parsed));
  }

  private shouldUseBudgetInputFallback(input: GenericTypeOptions, hints: string[]): boolean {
    const combined = `${input.label ?? ''} ${hints.join(' ')} ${input.value}`.toLowerCase();
    return /(price|가격|budget|예산|만원|원\s*이하|max|최대|상한|cost|금액)/i.test(combined);
  }

  private async collectBudgetInputCandidates(hints: string[], label: string): Promise<DomActionCandidate[]> {
    const page = this.requirePage();
    await this.clearCandidateMarkers();
    const normalizedHints = hints
      .map((hint) => normalizeText(hint.toLowerCase()))
      .filter((hint) => hint.length > 0)
      .slice(0, 10);
    const rows = await page.evaluate(
      ({ hints: queryHints, labelText }) => {
        let serial = 0;
        const candidates: Array<{
          id: string;
          selector: string;
          role: string;
          text: string;
          score: number;
          bbox: [number, number, number, number];
          attributes: Record<string, string>;
        }> = [];
        const combinedLabel = labelText.toLowerCase();
        const nodes = Array.from(document.querySelectorAll('input, textarea')) as HTMLElement[];
        for (const node of nodes) {
          if (!(node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement)) {
            continue;
          }
          if (node instanceof HTMLInputElement) {
            const type = (node.type ?? '').toLowerCase();
            if (type === 'hidden' || type === 'checkbox' || type === 'radio' || type === 'file') {
              continue;
            }
            if (node.disabled || node.readOnly) {
              continue;
            }
          }
          const rect = node.getBoundingClientRect();
          if (rect.width <= 2 || rect.height <= 2) {
            continue;
          }
          if (rect.bottom < -50 || rect.top > window.innerHeight + 1500) {
            continue;
          }
          const style = window.getComputedStyle(node);
          if (style.display === 'none' || style.visibility === 'hidden' || style.pointerEvents === 'none') {
            continue;
          }
          const centerX = Math.min(window.innerWidth - 1, Math.max(1, rect.left + rect.width / 2));
          const centerY = Math.min(window.innerHeight - 1, Math.max(1, rect.top + rect.height / 2));
          const topNode = document.elementFromPoint(centerX, centerY);
          if (!topNode || !(topNode === node || node.contains(topNode) || (topNode instanceof HTMLElement && topNode.contains(node)))) {
            continue;
          }

          const inputType = node instanceof HTMLInputElement ? (node.type ?? '').toLowerCase() : 'textarea';
          const id = (node.getAttribute('id') ?? '').trim();
          const className = (node.getAttribute('class') ?? '').trim();
          const name = (node.getAttribute('name') ?? '').trim();
          const aria = (node.getAttribute('aria-label') ?? '').trim();
          const placeholder = (node.getAttribute('placeholder') ?? '').trim();
          const value = (node as HTMLInputElement).value ?? '';
          const labelByFor = id
            ? (document.querySelector(`label[for="${CSS.escape(id)}"]`)?.textContent ?? '')
            : '';
          const wrapLabel = (node.closest('label')?.textContent ?? '').trim();
          const nearby = (node.closest('form, section, aside, div')?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
          const descriptor = `${aria} ${placeholder} ${name} ${id} ${className} ${labelByFor} ${wrapLabel} ${nearby}`.toLowerCase();
          const inPriceContext = Boolean(
            node.closest(
              '[class*="price"], [id*="price"], [class*="budget"], [id*="budget"], [class*="filter"], [id*="filter"], [class*="cost"], [id*="cost"], [class*="search_option"], [id*="search_option"], aside'
            )
          );
          const searchInputLike = /(search|검색|query|keyword|키워드|akc|통합검색|찾기)/i.test(descriptor);
          const priceKeywordMatched =
            /(가격|price|cost|금액|예산|budget|만원|원|최대|max|상한|미만|이하|range)/i.test(descriptor) ||
            /(price|budget|max|min|cost)/i.test(combinedLabel);
          if (searchInputLike && !priceKeywordMatched) {
            continue;
          }
          if (!inPriceContext && !priceKeywordMatched) {
            continue;
          }

          let score = 0.4;
          if (inPriceContext) {
            score += 0.45;
          }
          if (priceKeywordMatched) {
            score += 0.55;
          }
          if (inputType === 'number' || /(number|tel)/.test(inputType)) {
            score += 0.25;
          }
          if (/최대|max|상한|to|까지/.test(descriptor)) {
            score += 0.25;
          }
          if (/최소|min|from|이상/.test(descriptor)) {
            score -= 0.08;
          }
          if (searchInputLike) {
            score -= 1.1;
          }
          const hintMatched = queryHints.filter((hint) => descriptor.includes(hint)).length;
          if (queryHints.length > 0 && hintMatched > 0) {
            score += Math.min(0.45, hintMatched / Math.max(1, queryHints.length));
          }
          if (score < 0.55) {
            continue;
          }

          serial += 1;
          const markerId = `wa-input-${serial}`;
          node.setAttribute('data-wa-input-id', markerId);
          candidates.push({
            id: markerId,
            selector: `[data-wa-input-id="${markerId}"]`,
            role: 'textbox',
            text: `${aria || placeholder || labelByFor || wrapLabel || name || 'budget-input'} ${value}`.trim(),
            score,
            bbox: [rect.x, rect.y, rect.width, rect.height],
            attributes: {
              id,
              class: className,
              'aria-label': aria,
              placeholder,
              type: inputType,
              name,
              nearbyText: nearby,
              region: inPriceContext ? 'filter' : ''
            }
          });
        }

        candidates.sort((left, right) => right.score - left.score);
        return candidates.slice(0, 80);
      },
      { hints: normalizedHints, labelText: label }
    );
    return rows.map((row) => ({
      ...row,
      score: Number.isFinite(row.score) ? row.score : 0
    }));
  }

  async clickFirst(selectors: string[], label: string): Promise<ClickResult> {
    const page = this.requirePage();

    for (const selector of selectors) {
      const locator = page.locator(selector).first();
      const totalMatched = await ignore(page.locator(selector).count());
      const hasStrongAnchor = /(#|\[data-[a-z0-9_-]+=?|\[id=|\[aria-[a-z0-9_-]+=?|:nth|:has-text\(|:text\(|aria=|role=|xpath=)/i.test(
        selector
      );
      if (!hasStrongAnchor && typeof totalMatched === 'number' && totalMatched > 4) {
        continue;
      }
      const visible = await ignore(locator.isVisible({ timeout: 2000 }));
      if (!visible) {
        continue;
      }
      const interactable = await this.isLocatorInteractable(locator);
      if (!interactable) {
        continue;
      }

      const text = normalizeText((await ignore(locator.textContent())) ?? '');
      try {
        await locator.click({ timeout: 3000 });
      } catch (error) {
        if (!isRecoverableClickError(error)) {
          throw error;
        }
        await ignore(page.waitForTimeout(350));
        continue;
      }
      await ignore(page.waitForLoadState('domcontentloaded', { timeout: 8000 }));

      return {
        clicked: true,
        selector,
        text: text.length > 0 ? text : undefined,
        urlAfter: page.url()
      };
    }

    return { clicked: false };
  }

  async clickByHints(input: GenericClickOptions): Promise<DriverLog[]> {
    const label = input.label ?? 'generic-click';
    try {
      const page = this.requirePage();
      const selectors = (input.selectors ?? []).filter((value) => normalizeText(value).length > 0);
      const textHints = (input.textHints ?? []).map((value) => normalizeText(value.toLowerCase())).filter((value) => value.length > 0);

      if (selectors.length > 0) {
        const fromSelectors = await this.clickFirst(selectors, label);
        if (fromSelectors.clicked) {
          return [
            {
              level: 'info',
              message: `Action click(${label}): selector=${fromSelectors.selector ?? 'n/a'} text=${fromSelectors.text ?? 'n/a'} url=${fromSelectors.urlAfter ?? 'n/a'}`
            }
          ];
        }
      }
      if (textHints.length === 0) {
        return [
          {
            level: 'warn',
            message: `Action click(${label}) skipped: no selectors and no text hints`
          }
        ];
      }

      const rootHintMode = textHints.some((hint) => /(카테고리|category|메뉴|전체)/i.test(hint));
      const wantsSearch = textHints.some((hint) => /(검색|search)/i.test(hint)) || /(search|query)/i.test(label);
      const wantsFilter = textHints.some((hint) => /(필터|조건|색상|가격|정렬|sort|filter)/i.test(hint)) || /(filter|sort)/i.test(label);
      const rawCandidates = await this.collectClickableCandidates(textHints, {
        label,
        rootHintMode,
        wantsSearch,
        wantsFilter
      });
      const ranked = await this.rankCandidatesByContext(rawCandidates, {
        hints: textHints,
        label,
        forceSemantic: wantsSearch || wantsFilter || rootHintMode
      });

      for (const candidate of ranked.candidates.slice(0, 5)) {
        if (wantsFilter && this.isLikelyProductOrAdCandidate(candidate)) {
          continue;
        }
        if (wantsFilter && !this.isLikelyFilterControlCandidate(candidate)) {
          continue;
        }
        const objectiveCheck = this.candidateMatchesObjective(candidate, input.objective);
        if (!objectiveCheck.ok) {
          continue;
        }
        const locator = page.locator(candidate.selector).first();
        const visible = await ignore(locator.isVisible({ timeout: 1500 }));
        if (!visible) {
          continue;
        }
        const interactable = await this.isLocatorInteractable(locator);
        if (!interactable) {
          continue;
        }
        const beforeUrl = page.url();
        const text = normalizeText((await ignore(locator.textContent())) ?? candidate.text);
        try {
          await locator.click({ timeout: 3000 });
        } catch (error) {
          if (!isRecoverableClickError(error)) {
            throw error;
          }
          await ignore(page.waitForTimeout(420));
          continue;
        }
        await ignore(page.waitForLoadState('domcontentloaded', { timeout: 15000 }));
        await ignore(page.waitForTimeout(450));
        const pageObjective = await this.pageMatchesObjective(input.objective);
        if (!pageObjective.ok) {
          const afterUrl = page.url();
          if (afterUrl !== beforeUrl) {
            await ignore(page.goBack({ waitUntil: 'domcontentloaded', timeout: 12_000 }));
            await ignore(page.waitForTimeout(280));
          }
          continue;
        }
        const weakTransition = this.isWeakTransition(beforeUrl, page.url(), candidate.href);
        if (weakTransition) {
          const recovered = await this.recoverFromWeakTransition({
            beforeUrl,
            hints: textHints,
            objective: input.objective,
            label
          });
          if (recovered.recovered) {
            return [
              {
                level: 'info',
                message: `Action click(${label}): strategy=recovered backend=${ranked.metadata?.vectorBackend ?? 'n/a'} text=${recovered.clickedText ?? text ?? 'n/a'} href=${recovered.clickedHref ?? candidate.href ?? 'n/a'}`
              }
            ];
          }
        }
        return [
          {
            level: 'info',
            message: `Action click(${label}): strategy=${ranked.metadata?.strategy ?? 'structure_first'} backend=${ranked.metadata?.vectorBackend ?? 'n/a'} text=${text || 'n/a'} href=${candidate.href ?? 'n/a'}`
          }
        ];
      }

      return [
        {
          level: 'warn',
          message: `Action click(${label}) skipped: no matching candidate after structural/semantic ranking`
        }
      ];
    } catch (error) {
      if (isTransientNavigationError(error)) {
        return [
          {
            level: 'warn',
            message: `Action click(${label}) skipped: transient navigation/context change`
          }
        ];
      }
      throw error;
    }
  }

  private async submitInputWithFallback(locator: Locator, page: Page): Promise<void> {
    try {
      await locator.press('Enter', { timeout: 4000 });
      return;
    } catch {
      // fall through to less strict submit paths
    }

    const keyboardSubmitted = await ignore(page.keyboard.press('Enter'));
    if (keyboardSubmitted !== undefined) {
      return;
    }

    await ignore(
      locator.evaluate((element) => {
        const form =
          element instanceof HTMLElement
            ? (element.closest('form') as HTMLFormElement | null)
            : null;
        if (!form) {
          return false;
        }
        if (typeof form.requestSubmit === 'function') {
          form.requestSubmit();
          return true;
        }
        form.submit();
        return true;
      })
    );
  }

  async typeByHints(input: GenericTypeOptions): Promise<DriverLog[]> {
    const label = input.label ?? 'generic-type';
    try {
      const page = this.requirePage();
      const selectors = (input.selectors ?? []).filter((value) => normalizeText(value).length > 0);
      const textHints = (input.textHints ?? []).map((value) => normalizeText(value.toLowerCase())).filter((value) => value.length > 0);
      const value = input.value;
      const submit = input.submit ?? false;
      const typingIntent = input.intent ?? 'auto';
      const allowBudgetFallback = input.allowBudgetFallback ?? true;
      const resolvedFillValue = async (locator: Locator): Promise<string> => {
        const inputType = ((await ignore(locator.getAttribute('type'))) ?? '').toLowerCase();
        if (inputType === 'number' || inputType === 'tel') {
          return this.extractBudgetFillValue(value);
        }
        return value;
      };

      for (const selector of selectors) {
        const locator = page.locator(selector).first();
        const visible = await ignore(locator.isVisible({ timeout: 2000 }));
        if (!visible) {
          continue;
        }
        const fillValue = await resolvedFillValue(locator);
        try {
          await locator.fill(fillValue, { timeout: 7000 });
        } catch (error) {
          if (isRecoverableFillError(error)) {
            continue;
          }
          throw error;
        }
        if (submit) {
          await this.submitInputWithFallback(locator, page);
        }
        await ignore(page.waitForLoadState('domcontentloaded', { timeout: 15000 }));
        return [
          {
            level: 'info',
            message: `Action type(${label}): selector=${selector} chars=${value.length} submit=${submit}`
          }
        ];
      }
      const rawCandidates = await this.collectInputCandidates(textHints);
      const ranked = await this.rankCandidatesByContext(rawCandidates, {
        hints: textHints,
        label,
        intent: typingIntent === 'filter' ? 'generic' : 'search',
        forceSemantic: true
      });

      for (const candidate of ranked.candidates.slice(0, 5)) {
        const locator = page.locator(candidate.selector).first();
        const visible = await ignore(locator.isVisible({ timeout: 1500 }));
        if (!visible) {
          continue;
        }
        const fillValue = await resolvedFillValue(locator);
        try {
          await locator.fill(fillValue, { timeout: 7000 });
        } catch (error) {
          if (isRecoverableFillError(error)) {
            continue;
          }
          throw error;
        }
        if (submit) {
          await this.submitInputWithFallback(locator, page);
        }
        await ignore(page.waitForLoadState('domcontentloaded', { timeout: 15000 }));
        return [
          {
            level: 'info',
            message: `Action type(${label}): strategy=${ranked.metadata?.strategy ?? 'structure_first'} backend=${ranked.metadata?.vectorBackend ?? 'n/a'} selector=${candidate.selector} chars=${value.length} submit=${submit}`
          }
        ];
      }

      if (allowBudgetFallback && this.shouldUseBudgetInputFallback(input, textHints)) {
        const fallbackHints = Array.from(
          new Set([...textHints, '가격', 'price', 'budget', '최대', 'max', '원', '만원', '금액'].map((row) => row.trim()))
        )
          .filter((row) => row.length > 0)
          .slice(0, 10);
        const fallbackCandidates = await this.collectBudgetInputCandidates(fallbackHints, label);
        const budgetFill = this.extractBudgetFillValue(value);
        for (const candidate of fallbackCandidates.slice(0, 6)) {
          const locator = page.locator(candidate.selector).first();
          const visible = await ignore(locator.isVisible({ timeout: 1200 }));
          if (!visible) {
            continue;
          }
          const interactable = await this.isLocatorInteractable(locator);
          if (!interactable) {
            continue;
          }
          try {
            await locator.fill(budgetFill, { timeout: 7000 });
          } catch (error) {
            if (isRecoverableFillError(error)) {
              continue;
            }
            throw error;
          }
          if (submit) {
            await this.submitInputWithFallback(locator, page);
            await ignore(page.waitForLoadState('domcontentloaded', { timeout: 15000 }));
          } else {
            await ignore(page.waitForTimeout(280));
          }
          return [
            {
              level: 'info',
              message: `Action type(${label}): strategy=budget_input_fallback selector=${candidate.selector} chars=${budgetFill.length} submit=${submit}`
            }
          ];
        }
      }

      return [
        {
          level: 'warn',
          message: `Action type(${label}) skipped: no matching input candidate after structural/semantic ranking`
        }
      ];
    } catch (error) {
      if (isTransientNavigationError(error)) {
        return [
          {
            level: 'warn',
            message: `Action type(${label}) skipped: transient navigation/context change`
          }
        ];
      }
      throw error;
    }
  }

  async waitForMilliseconds(ms: number): Promise<DriverLog[]> {
    const page = this.requirePage();
    const duration = Math.max(100, Math.min(15_000, Math.floor(ms)));
    await page.waitForTimeout(duration);
    return [
      {
        level: 'info',
        message: `Action wait: ${duration}ms`
      }
    ];
  }

  async capture(label: string): Promise<string | undefined> {
    const page = this.requirePage();
    if (!this.screenshotDir) {
      return undefined;
    }
    this.screenshotCount += 1;
    const filename = `${String(this.screenshotCount).padStart(2, '0')}-${sanitizePathPart(label)}.png`;
    const path = join(this.screenshotDir, filename);
    try {
      await page.screenshot({ path, fullPage: true });
    } catch {
      await page.screenshot({ path });
    }
    return path;
  }

  async summarizeHeadlines(maxItems = 5): Promise<string[]> {
    const page = this.requirePage();
    const headlines = await page.evaluate((limit) => {
      const selectors = [
        'a.cjs_t',
        'a.sa_text_title',
        'a.news_tit',
        'a[href*="/article/"]'
      ];
      const rows: string[] = [];
      const seen = new Set<string>();
      for (const selector of selectors) {
        const nodes = Array.from(document.querySelectorAll(selector));
        for (const node of nodes) {
          const text = (node.textContent ?? '').replace(/\s+/g, ' ').trim();
          if (!text || text.length < 6) {
            continue;
          }
          if (seen.has(text)) {
            continue;
          }
          seen.add(text);
          rows.push(text);
          if (rows.length >= limit) {
            return rows;
          }
        }
      }
      return rows;
    }, Math.max(1, maxItems));

    return headlines;
  }

  async navigateListingByHints(input: ListingNavigationOptions): Promise<DriverLog[]> {
    const page = this.requirePage();
    const logs: DriverLog[] = [];
    const pathHints = (input.pathHints ?? [])
      .map((hint) => normalizeText(hint))
      .filter((hint, index, list) => hint.length > 0 && list.indexOf(hint) === index);
    const maxSteps = this.resolveHintMaxPathSteps(input.maxPathSteps);
    const hints = pathHints.slice(0, maxSteps);
    const traversalHints = hints;
    const visitedCandidates = new Set<string>();
    const successfulHops: string[] = [];
    const appendHop = (raw: string): void => {
      const cleaned = normalizeText(raw);
      if (!cleaned) {
        return;
      }
      const previous = successfulHops[successfulHops.length - 1];
      if (previous && normalizeComparableText(previous) === normalizeComparableText(cleaned)) {
        return;
      }
      successfulHops.push(cleaned);
    };
    let preOpenCalls = 0;
    const maxPreOpenCalls = 14;
    let preOpenBudgetWarned = false;
    const configuredCandidateChecks = parseOptionalNumber(process.env.CHAT_AUTOMATION_HINT_MAX_CANDIDATE_CHECKS);
    const maxCandidateChecks = configuredCandidateChecks && Number.isFinite(configuredCandidateChecks)
      ? Math.min(120, Math.max(20, Math.floor(configuredCandidateChecks)))
      : 44;
    let candidateBudgetWarned = false;
    const preOpenSeen = new Set<string>();

    const applyPreOpen = async (
      preHints: string[],
      reason: 'initial' | 'reopen',
      allowRepeat = false
    ): Promise<void> => {
      const normalized = preHints
        .map((hint) => normalizeText(hint.toLowerCase()))
        .filter((hint) => hint.length > 0)
        .slice(0, 4);
      const key = `${reason}:${normalized.join('|')}`;
      if (!allowRepeat && preOpenSeen.has(key)) {
        return;
      }
      if (preOpenCalls >= maxPreOpenCalls) {
        if (!preOpenBudgetWarned) {
          logs.push({
            level: 'warn',
            message: `Hint navigation pre-open budget reached: calls=${preOpenCalls}/${maxPreOpenCalls}`
          });
          preOpenBudgetWarned = true;
        }
        return;
      }
      preOpenCalls += 1;
      preOpenSeen.add(key);
      const preOpenLogs = await this.expandNavigationSurface(preHints);
      logs.push(...preOpenLogs);
    };

    await ignore(page.waitForTimeout(500));

    const rootHintMode = traversalHints.some((hint) => /(카테고리|category|메뉴|menu|전체)/i.test(hint));
    const rootOnlySequence =
      traversalHints.length > 0 && traversalHints.every((hint) => this.isGenericNavigationRootHint(hint));
    if (rootHintMode) {
      await applyPreOpen(hints, 'initial');
    }
    if (rootOnlySequence && traversalHints.length >= 2) {
      const openedSurface = await this.hasFollowupNavigationCandidates(['카테고리', '메뉴', 'category', 'menu']);
      if (openedSurface || preOpenCalls > 0) {
        logs.push({
          level: 'info',
          message: 'Hint navigation hover expansion: text=menu-root nextHints=[category]'
        });
        logs.push({
          level: 'info',
          message: 'Hint navigation hop 1/1: text=menu-root strategy=preopen backend=n/a href=n/a'
        });
        logs.push({
          level: 'info',
          message: 'Hint navigation traversal completed: hops=1/1 path=menu-root'
        });
      } else {
        logs.push({
          level: 'warn',
          message: `Hint navigation skipped: no candidate for [${traversalHints.join(', ')}]`
        });
      }
      return logs;
    }

    const buildQuerySets = (hop: number): string[][] => {
      const current = traversalHints[hop];
      if (!current) {
        return [];
      }
      const near = traversalHints.slice(hop, Math.min(traversalHints.length, hop + 2));
      const broader = traversalHints.slice(hop, Math.min(traversalHints.length, hop + 3));
      const all = traversalHints.slice(0, Math.min(traversalHints.length, maxSteps));
      const sets = [
        [current],
        near,
        broader,
        all
      ];
      const deduped: string[][] = [];
      const seen = new Set<string>();
      for (const row of sets) {
        const cleaned = row
          .map((item) => normalizeText(item))
          .filter((item, index, list) => item.length > 0 && list.indexOf(item) === index);
        if (cleaned.length === 0) {
          continue;
        }
        const key = cleaned.join('||').toLowerCase();
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        deduped.push(cleaned);
      }
      return deduped;
    };

    const navigationStartUrl = page.url();
    const hopBudget = Math.min(
      traversalHints.length,
      this.resolveHintHopsPerAction(traversalHints.length, maxSteps)
    );

    try {
      let budgetExhausted = false;
      for (let hop = 0; hop < hopBudget; hop += 1) {
        let hopCandidateChecks = 0;
        let querySets = buildQuerySets(hop);
        const isFinalHop = hop === hopBudget - 1;
        let hopClicked = false;
        let hoverExpansionAttempted = false;
        const hasNextHop = hop + 1 < hopBudget;
        if (hop === 0 && hasNextHop && querySets.length > 1) {
          querySets = querySets.slice(0, 1);
        }

        for (const queryHints of querySets) {
          const effectiveQueryHints = this.expandNavigationHints(queryHints, { broad: false });
          const nextHopHintSignals = hasNextHop
            ? this.expandNavigationHints(traversalHints.slice(hop + 1, Math.min(traversalHints.length, hop + 2)), {
                broad: false
              })
            : [];
          const hopRootHintMode =
            hop === 0 && effectiveQueryHints.some((hint) => /(카테고리|category|메뉴|menu|전체)/i.test(hint));
          const hopObjective = this.buildHintObjective(
            input.objective,
            effectiveQueryHints,
            isFinalHop,
            hop === 0
          );
          let rawCandidates = await this.collectClickableCandidates(effectiveQueryHints, {
            label: 'hint-navigate',
            rootHintMode: hopRootHintMode,
            wantsSearch: false,
            wantsFilter: false,
            allowLooseNavigationMatch: hasNextHop
          });
          if (rawCandidates.length === 0 && !hopRootHintMode) {
            const reopenHints = [
              '카테고리',
              '전체카테고리',
              '메뉴',
              'category',
              'menu',
              ...effectiveQueryHints.slice(0, 2)
            ];
            for (let reopenProbe = 0; reopenProbe < 2; reopenProbe += 1) {
              await applyPreOpen(reopenHints, 'reopen');
              await ignore(page.waitForTimeout(reopenProbe > 0 ? 70 : 30));
              rawCandidates = await this.collectClickableCandidates(effectiveQueryHints, {
                label: 'hint-navigate-reopen',
                rootHintMode: false,
                wantsSearch: false,
                wantsFilter: false,
                allowLooseNavigationMatch: hasNextHop
              });
              if (rawCandidates.length > 0) {
                break;
              }
            }
            if (rawCandidates.length > 0) {
              logs.push({
                level: 'info',
                message: `Hint navigation surface re-opened for non-root hop: hints=[${effectiveQueryHints.join(', ')}] candidates=${rawCandidates.length}`
              });
            }
          }
          const ranked = await this.rankCandidatesByContext(rawCandidates, {
            hints: effectiveQueryHints,
            label: 'hint-navigate',
            intent: hopRootHintMode ? 'menu' : 'navigation',
            forceSemantic: true
          });
          const navigationScoped = hasNextHop || hopRootHintMode;
          const prioritized = this.prioritizeNavigationScopeCandidates(ranked.candidates, navigationScoped);
          const candidatePool =
            navigationScoped && prioritized.scopedCount > 0
              ? prioritized.ordered.filter((candidate) => this.isNavigationScopeCandidate(candidate))
              : prioritized.ordered;
          let orderedCandidatePool = candidatePool;
          if (!hopRootHintMode && orderedCandidatePool.length >= 2) {
            const visualReranked = await this.rerankNavigationCandidatesWithVlm({
              candidates: orderedCandidatePool,
              hints: effectiveQueryHints,
              objective: hopObjective,
              hop,
              hopBudget
            });
            orderedCandidatePool = visualReranked.candidates;
            logs.push(...visualReranked.logs);
          }
          if (navigationScoped && prioritized.scopedCount > 0) {
            logs.push({
              level: 'info',
              message: `Hint navigation scope lock: scoped=${prioritized.scopedCount}/${ranked.candidates.length} hop=${hop + 1}/${hopBudget}`
            });
          }

          for (const candidate of orderedCandidatePool.slice(0, 6)) {
            hopCandidateChecks += 1;
            if (hopCandidateChecks > maxCandidateChecks) {
              if (!candidateBudgetWarned) {
                logs.push({
                  level: 'warn',
                  message: `Hint navigation candidate budget reached: hop=${hop + 1}/${hopBudget} checks=${hopCandidateChecks}/${maxCandidateChecks}`
                });
                candidateBudgetWarned = true;
              }
              budgetExhausted = true;
              break;
            }
            const candidateKey = `${candidate.selector}::${candidate.href ?? ''}::${candidate.text}`;
            if (visitedCandidates.has(candidateKey)) {
              continue;
            }

            if (hasNextHop && hop === 0 && nextHopHintSignals.length > 0) {
              const evidenceText = this.candidateEvidenceText(candidate);
              const currentHopMatch = this.objectiveCheckFromText(
                evidenceText,
                {
                  includeAny: effectiveQueryHints,
                  strict: true
                },
                { hardAvoid: true }
              );
              const nextHopMatch = this.objectiveCheckFromText(
                evidenceText,
                {
                  includeAny: nextHopHintSignals,
                  strict: true
                },
                { hardAvoid: true }
              );
              if (currentHopMatch.includeMatches.length === 0 && nextHopMatch.includeMatches.length > 0) {
                logs.push({
                  level: 'warn',
                  message: `Hint navigation root-step guard: skip deep-level candidate text=${candidate.text || 'n/a'} currentHints=[${effectiveQueryHints.join(', ')}] nextHints=[${nextHopHintSignals.join(', ')}]`
                });
                continue;
              }
            }

            if (hasNextHop && this.isLikelyProductOrAdCandidate(candidate)) {
              logs.push({
                level: 'warn',
                message: `Hint navigation candidate skipped (product/ad guard): text=${candidate.text || 'n/a'} href=${candidate.href ?? 'n/a'}`
              });
              continue;
            }

            const locator = page.locator(candidate.selector).first();
            const visible = await ignore(locator.isVisible({ timeout: 1500 }));
            if (!visible) {
              continue;
            }
            const interactable = await this.isLocatorInteractable(locator);
            if (!interactable) {
              continue;
            }
            const objectiveCheck = this.candidateMatchesObjective(candidate, hopObjective);
            if (!objectiveCheck.ok) {
              let bridgeAccepted = false;
              if (hasNextHop && this.isNavigationScopeCandidate(candidate)) {
                const bridgeHints = this.expandNavigationHints(
                  traversalHints.slice(hop + 1, Math.min(traversalHints.length, hop + 3)),
                  { broad: false }
                );
                if (bridgeHints.length > 0) {
                  let bridgeFollowupReady = false;
                  try {
                    await locator.hover({ timeout: 2200 });
                    await ignore(page.waitForTimeout(180));
                    bridgeFollowupReady = await this.hasFollowupNavigationCandidates(bridgeHints);
                  } catch (error) {
                    if (!isRecoverableClickError(error)) {
                      throw error;
                    }
                  }
                  if (!bridgeFollowupReady) {
                    const forcedHover = await this.forceHoverBySelector(candidate.selector);
                    if (forcedHover) {
                      await ignore(page.waitForTimeout(140));
                      bridgeFollowupReady = await this.hasFollowupNavigationCandidates(bridgeHints);
                    }
                  }
                  if (bridgeFollowupReady) {
                    logs.push({
                      level: 'info',
                      message: `Hint navigation bridge accepted: text=${candidate.text || effectiveQueryHints[0] || 'n/a'} nextHints=[${bridgeHints.join(', ')}]`
                    });
                    appendHop(candidate.text || effectiveQueryHints[0] || `hop-${hop + 1}`);
                    hopClicked = true;
                    bridgeAccepted = true;
                  }
                }
              }
              if (bridgeAccepted) {
                break;
              }
              logs.push({
                level: 'warn',
                message: `Hint navigation candidate skipped by objective gate: text=${candidate.text || 'n/a'} include=${objectiveCheck.includeMatches.join('|') || 'none'} avoid=${objectiveCheck.avoidMatches.join('|') || 'none'}`
              });
              continue;
            }
            const previousHop = successfulHops[successfulHops.length - 1];
            const candidateHopText = candidate.text || effectiveQueryHints[0] || `hop-${hop + 1}`;
            if (
              hasNextHop &&
              previousHop &&
              normalizeComparableText(previousHop) === normalizeComparableText(candidateHopText)
            ) {
              logs.push({
                level: 'warn',
                message: `Hint navigation candidate skipped (repeat-guard): text=${candidateHopText}`
              });
              continue;
            }
            visitedCandidates.add(candidateKey);

            if (hasNextHop) {
              const followupHints = this.expandNavigationHints(
                traversalHints.slice(hop + 1, Math.min(traversalHints.length, hop + 3)),
                { broad: false }
              );
              hoverExpansionAttempted = true;
              const followupBeforeHover = await this.hasFollowupNavigationCandidates(followupHints);
              if (!followupBeforeHover && followupHints.length > 0) {
                let followupAfterHover = false;
                try {
                  await locator.hover({ timeout: 2500 });
                  await ignore(page.waitForTimeout(220));
                  followupAfterHover = await this.hasFollowupNavigationCandidates(followupHints);
                } catch (error) {
                  if (!isRecoverableClickError(error)) {
                    const message = error instanceof Error ? error.message.split('\n')[0] ?? error.message : String(error);
                    logs.push({
                      level: 'warn',
                      message: `Hint navigation hover skipped: text=${candidate.text || effectiveQueryHints[0] || 'n/a'} reason=${message}`
                    });
                  }
                }
                if (!followupAfterHover) {
                  const forcedHover = await this.forceHoverBySelector(candidate.selector);
                  if (forcedHover) {
                    await ignore(page.waitForTimeout(180));
                    followupAfterHover = await this.hasFollowupNavigationCandidates(followupHints);
                    if (followupAfterHover) {
                      logs.push({
                        level: 'info',
                        message: `Hint navigation hover expansion (forced): text=${candidate.text || effectiveQueryHints[0] || 'n/a'} nextHints=[${followupHints.join(', ')}]`
                      });
                    }
                  }
                }
                if (followupAfterHover) {
                  logs.push({
                    level: 'info',
                    message: `Hint navigation hover expansion: text=${candidate.text || effectiveQueryHints[0] || 'n/a'} nextHints=[${followupHints.join(', ')}]`
                  });
                  appendHop(candidate.text || effectiveQueryHints[0] || `hop-${hop + 1}`);
                  hopClicked = true;
                  break;
                }
              }
            }

            const beforeUrl = page.url();
            try {
              await locator.click({ timeout: 2500 });
            } catch (error) {
              if (!isRecoverableClickError(error)) {
                throw error;
              }
              const message = error instanceof Error ? error.message.split('\n')[0] ?? error.message : String(error);
              let retrySucceeded = false;
              if (hasNextHop && this.isNavigationScopeCandidate(candidate)) {
                const reopenHints = ['카테고리', '메뉴', 'category', 'menu', ...effectiveQueryHints.slice(0, 2)];
                await applyPreOpen(reopenHints, 'reopen', true);
                await ignore(page.waitForTimeout(120));
                const retryLocator = page.locator(candidate.selector).first();
                const retryVisible = await ignore(retryLocator.isVisible({ timeout: 1000 }));
                if (retryVisible && (await this.isLocatorInteractable(retryLocator))) {
                  try {
                    await retryLocator.click({ timeout: 2200 });
                    retrySucceeded = true;
                    logs.push({
                      level: 'info',
                      message: `Hint navigation click retry succeeded: text=${candidate.text || effectiveQueryHints[0] || 'n/a'}`
                    });
                  } catch (retryError) {
                    if (!isRecoverableClickError(retryError)) {
                      throw retryError;
                    }
                  }
                }
                if (!retrySucceeded) {
                  const forcedClicked = await this.forceClickBySelector(candidate.selector);
                  if (forcedClicked) {
                    retrySucceeded = true;
                    logs.push({
                      level: 'info',
                      message: `Hint navigation forced click applied: text=${candidate.text || effectiveQueryHints[0] || 'n/a'}`
                    });
                  }
                }
              }
              if (!retrySucceeded) {
                logs.push({
                  level: 'warn',
                  message: `Hint navigation click skipped (recoverable): text=${candidate.text || 'n/a'} selector=${candidate.selector} reason=${message}`
                });
                await ignore(page.waitForTimeout(420));
                continue;
              }
            }

            await ignore(page.waitForLoadState('domcontentloaded', { timeout: 15000 }));
            await ignore(page.waitForTimeout(450));

            const afterUrl = page.url();
            const afterTitle = (await ignore(page.title())) ?? '';
            if (!sameAllowedRoot(afterUrl, this.allowedRootDomain)) {
              logs.push({
                level: 'warn',
                message: `Hint navigation rollback: moved outside allowed root (${this.allowedRootDomain ?? 'n/a'}) -> ${afterUrl}`
              });
              await ignore(page.goBack({ waitUntil: 'domcontentloaded', timeout: 12_000 }));
              await ignore(page.waitForTimeout(320));
              continue;
            }
            if (hopRootHintMode && looksPromotionLike(afterUrl, afterTitle)) {
              logs.push({
                level: 'warn',
                message: `Hint navigation landed on promotional page; rollback url=${afterUrl}`
              });
              await ignore(page.goBack({ waitUntil: 'domcontentloaded', timeout: 12_000 }));
              await ignore(page.waitForTimeout(300));
              continue;
            }

            const pageObjective = await this.pageMatchesObjective(hopObjective);
            const hopNeedsIncludeSignal =
              hopRootHintMode &&
              Array.isArray(hopObjective?.includeAny) &&
              (hopObjective?.includeAny?.length ?? 0) > 0;
            const hopIncludeSatisfied = pageObjective.includeMatches.length > 0;
            if (!pageObjective.ok) {
              logs.push({
                level: 'warn',
                message: `Hint navigation rollback by objective gate: url=${afterUrl} include=${pageObjective.includeMatches.join('|') || 'none'} avoid=${pageObjective.avoidMatches.join('|') || 'none'}`
              });
              if (afterUrl !== beforeUrl) {
                await ignore(page.goBack({ waitUntil: 'domcontentloaded', timeout: 12_000 }));
                await ignore(page.waitForTimeout(320));
              }
              continue;
            }
            if (hopNeedsIncludeSignal && !hopIncludeSatisfied) {
              logs.push({
                level: 'warn',
                message: `Hint navigation rollback: root objective include tokens not found on destination (${afterUrl})`
              });
              if (afterUrl !== beforeUrl) {
                await ignore(page.goBack({ waitUntil: 'domcontentloaded', timeout: 12_000 }));
                await ignore(page.waitForTimeout(320));
              }
              continue;
            }

            const weakSamePageTransition = this.isWeakTransition(beforeUrl, afterUrl, candidate.href);
            if (weakSamePageTransition) {
              const recovered = await this.recoverFromWeakTransition({
                beforeUrl,
                hints: queryHints,
                objective: hopObjective,
                label: 'hint-navigate'
              });
              logs.push(...recovered.logs);
              if (recovered.recovered) {
                logs.push({
                  level: 'info',
                  message: `Hint navigation hop ${hop + 1}/${hopBudget}: text=${recovered.clickedText || candidate.text || queryHints[0] || 'n/a'} strategy=recovered backend=${ranked.metadata?.vectorBackend ?? 'n/a'} href=${recovered.clickedHref ?? candidate.href ?? 'n/a'}`
                });
                appendHop(recovered.clickedText || candidate.text || queryHints[0] || `hop-${hop + 1}`);
                hopClicked = true;
                break;
              }
              const hasFurtherHop = hop + 1 < hopBudget;
              if (hasFurtherHop) {
                const followupHints = traversalHints.slice(hop + 1, Math.min(traversalHints.length, hop + 3));
                const expandedFollowupHints = this.expandNavigationHints(followupHints, { broad: false });
                const followupAvailable = await this.hasFollowupNavigationCandidates(expandedFollowupHints);
                const repeatedWeakStep =
                  previousHop &&
                  normalizeComparableText(previousHop) === normalizeComparableText(candidateHopText);
                if (repeatedWeakStep) {
                  logs.push({
                    level: 'warn',
                    message: `Hint navigation weak transition rejected (repeat-guard): text=${candidate.text || queryHints[0] || 'n/a'}`
                  });
                  if (afterUrl !== beforeUrl) {
                    await ignore(page.goBack({ waitUntil: 'domcontentloaded', timeout: 12_000 }));
                    await ignore(page.waitForTimeout(260));
                  }
                  continue;
                }
                if (!followupAvailable) {
                  logs.push({
                    level: 'warn',
                    message: `Hint navigation weak transition rejected: no followup candidates after click text=${candidate.text || queryHints[0] || 'n/a'} href=${candidate.href ?? 'n/a'}`
                  });
                  if (afterUrl !== beforeUrl) {
                    await ignore(page.goBack({ waitUntil: 'domcontentloaded', timeout: 12_000 }));
                    await ignore(page.waitForTimeout(260));
                  }
                  continue;
                }
                logs.push({
                  level: 'info',
                  message: `Hint navigation weak expansion accepted: text=${candidate.text || effectiveQueryHints[0] || 'n/a'} nextHints=[${expandedFollowupHints.join(', ')}]`
                });
              } else {
                logs.push({
                  level: 'warn',
                  message: `Hint navigation weak progress via click: text=${candidate.text || effectiveQueryHints[0] || 'n/a'} href=${candidate.href ?? 'n/a'}`
                });
              }
            }

            logs.push({
              level: 'info',
              message: `Hint navigation hop ${hop + 1}/${hopBudget}: text=${candidate.text || effectiveQueryHints[0] || 'n/a'} strategy=${ranked.metadata?.strategy ?? 'structure_first'} backend=${ranked.metadata?.vectorBackend ?? 'n/a'} href=${candidate.href ?? 'n/a'}`
            });
            appendHop(candidate.text || effectiveQueryHints[0] || `hop-${hop + 1}`);
            hopClicked = true;
            break;
          }
          if (budgetExhausted) {
            break;
          }

          if (hopClicked) {
            break;
          }
        }
        if (budgetExhausted) {
          break;
        }

        if (!hopClicked) {
          if (hasNextHop && hop === 0 && hoverExpansionAttempted) {
            logs.push({
              level: 'info',
              message:
                'Hint navigation hover expansion: attempted but no stable followup candidate detected; continuing traversal'
            });
          }
          logs.push({
            level: 'warn',
            message: `Hint navigation hop ${hop + 1}/${hopBudget} skipped: no candidate for [${traversalHints[hop] ?? 'n/a'}]`
          });
        }
      }

      if (successfulHops.length === 0) {
        logs.push({
          level: 'warn',
          message: `Hint navigation skipped: no candidate for [${traversalHints.join(', ')}]`
        });
      } else {
        const endedAtRoot = stripHash(page.url()) === stripHash(navigationStartUrl);
        if (endedAtRoot) {
          const finalHints = this.expandNavigationHints(
            traversalHints.slice(Math.max(0, hopBudget - 2), hopBudget),
            { broad: false }
          );
          const commitObjective = this.buildHintObjective(
            input.objective,
            finalHints,
            true,
            false
          );
          const committed = await this.commitNavigationFromOverlay({
            hints: finalHints,
            objective: commitObjective,
            startUrl: navigationStartUrl,
            label: 'hint-navigate'
          });
          logs.push(...committed.logs);
          if (committed.committed) {
            appendHop(committed.clickedText || finalHints[0] || 'commit');
          }
        }
        logs.push({
          level: 'info',
          message: `Hint navigation traversal completed: hops=${successfulHops.length}/${hopBudget} path=${successfulHops.join(' -> ')}`
        });
      }
    } catch (error) {
      if (isTransientNavigationError(error)) {
        logs.push({
          level: 'warn',
          message: 'Hint navigation transient skip (navigation in progress)'
        });
        await ignore(page.waitForLoadState('domcontentloaded', { timeout: 12000 }));
        await ignore(page.waitForTimeout(500));
      } else {
        throw error;
      }
    }

    if (input.sortPriceAsc) {
      let sortResult: {
        matched: boolean;
        text?: string;
        href?: string;
        action?: 'navigate' | 'click';
      };
      try {
        sortResult = await page.evaluate((allowedRoot) => {
        const sortHints = [
          '낮은 가격순',
          '가격 낮은순',
          '낮은순',
          '가격순',
          'lowest price',
          'price low'
        ];
          const clickable = Array.from(
            document.querySelectorAll('a[href], button, [role="button"], option')
          ) as HTMLElement[];

        let best:
          | {
              score: number;
              text: string;
              href?: string;
              action: 'navigate' | 'click';
            }
          | undefined;
        let target: HTMLElement | undefined;

        for (const node of clickable) {
          const text = (node.textContent ?? '').replace(/\s+/g, ' ').trim();
          if (!text) {
            continue;
          }
          const normalized = text.toLowerCase();
          if (/(쿠팡|베스트|오늘주문|내일도착|특가|광고|추천|랭킹)/i.test(normalized)) {
            continue;
          }
          const descriptor = [
            node.getAttribute('id') ?? '',
            node.getAttribute('class') ?? '',
            node.getAttribute('aria-label') ?? '',
            node.closest('[class*="sort"], [id*="sort"], [class*="order"], [id*="order"], [class*="filter"], [id*="filter"]')?.getAttribute('class') ?? ''
          ]
            .join(' ')
            .toLowerCase();
          const contextText = `${normalized} ${descriptor}`;
          let matched = 0;
          for (const hint of sortHints) {
            if (normalized.includes(hint.toLowerCase())) {
              matched += 1;
            }
          }
          const sortContextMatched =
            /sort|정렬|order|가격순|price/.test(contextText) ||
            node.tagName.toLowerCase() === 'option' ||
            node.closest('select, [class*="sort"], [id*="sort"], [class*="order"], [id*="order"]') != null;
          if (matched === 0) {
            if (!sortContextMatched) {
              continue;
            }
            if (!/낮은|낮음|low|ascending|오름차순/.test(contextText)) {
              continue;
            }
          }
          if (!sortContextMatched) {
            continue;
          }

          const href = (node as HTMLAnchorElement).href || undefined;
          if (href) {
            try {
              const parsed = new URL(href, window.location.href);
              const hrefHost = parsed.hostname.toLowerCase();
              const sameAllowedRoot = !allowedRoot || hrefHost === allowedRoot || hrefHost.endsWith(`.${allowedRoot}`);
              if (!sameAllowedRoot) {
                continue;
              }
              const hrefSignals = `${parsed.pathname}${parsed.search}`.toLowerCase();
              if (!/sort|order|price|low|asc/.test(hrefSignals) && !sortContextMatched) {
                continue;
              }
            } catch {
              continue;
            }
          }
          const score = matched + (sortContextMatched ? 0.7 : 0) + (/낮은|lowest|low|오름차순|ascending/.test(contextText) ? 0.6 : 0);
          if (!best || score > best.score) {
            best = {
              score,
              text,
              href,
              action: href ? 'navigate' : 'click'
            };
            target = node;
          }
        }

        if (!best || !target) {
          return { matched: false };
        }

        if (best.href) {
          window.location.href = best.href;
        } else {
          target.click();
        }

        return {
          matched: true,
          text: best.text,
          href: best.href,
          action: best.action
        };
      }, this.allowedRootDomain ?? null);
      } catch (error) {
        if (isTransientNavigationError(error)) {
          logs.push({
            level: 'warn',
            message: 'Sort action skipped due transient navigation context change'
          });
          await ignore(page.waitForLoadState('domcontentloaded', { timeout: 12000 }));
          await ignore(page.waitForTimeout(500));
          return logs;
        }
        throw error;
      }

      if (sortResult.matched) {
        await ignore(page.waitForLoadState('domcontentloaded', { timeout: 15000 }));
        await ignore(page.waitForTimeout(600));
        logs.push({
          level: 'info',
          message: `Sort action applied (price ascending): ${sortResult.action} text=${sortResult.text ?? 'n/a'} href=${sortResult.href ?? 'n/a'}`
        });
      } else {
        logs.push({
          level: 'warn',
          message: 'Sort action skipped: no price-sort candidate found'
        });
      }
    }

    return logs;
  }

  async summarizeListingProducts(maxItems = 5, filter?: ListingProductFilter): Promise<ListingProductRow[]> {
    const page = this.requirePage();
    return page.evaluate((input: { limit: number; filter: ListingProductFilter | undefined }) => {
      const limit = input.limit;
      const inputFilter = input.filter;
      const rows: Array<{
        name: string;
        lumpSumLabel: string;
        lumpSumValue: number;
        installmentLabel: string;
        installmentMonthlyValue: number;
        installmentMonths?: number;
        installmentTotalValue: number;
        priceBasis: 'lump_sum' | 'installment' | 'unknown';
        sortPrice: number;
        inchValue?: number;
        isRental: boolean;
        isWomenWear: boolean;
        isHikingWear: boolean;
        isRed: boolean;
        source: 'prod_list' | 'search';
        domIndex: number;
      }> = [];
      const seen = new Set<string>();
      const prodItems = Array.from(
        document.querySelectorAll('.main_prodlist_list > ul > li.prod_item, li.prod_item')
      );
      const source: 'prod_list' | 'search' = prodItems.length > 0 ? 'prod_list' : 'search';
      const nodes =
        source === 'prod_list'
          ? prodItems
          : Array.from(document.querySelectorAll('.prod_main_info'));
      const options = inputFilter ?? {};
      const preferredInchValue =
        typeof options.preferInch === 'number' && Number.isFinite(options.preferInch)
          ? options.preferInch
          : undefined;

      const scopedNodes = nodes.slice(0, 120);
      for (let nodeIndex = 0; nodeIndex < scopedNodes.length; nodeIndex += 1) {
        const node = scopedNodes[nodeIndex]!;
        const primaryName = node.querySelector('p.prod_name a, a.prod_name, .prod_name a[href*="/info/"]')?.textContent ?? '';
        const fallbackName = node.querySelector('a[href*="/info/"], a[href*="/product/"]')?.textContent ?? '';
        const name = String(primaryName || fallbackName).replace(/\s+/g, ' ').trim();
        if (!name || seen.has(name)) {
          continue;
        }
        seen.add(name);

        const rowText = String(node.textContent ?? '').replace(/\s+/g, ' ').trim();
        const inchMatch = rowText.match(/(\d{2,3})\s*인치/i);
        const cmMatch = rowText.match(/(\d{2,3})\s*cm/i);
        const inch = inchMatch?.[1] ? Number(inchMatch[1]) : undefined;
        const cm = cmMatch?.[1] ? Number(cmMatch[1]) : undefined;
        let inchValue: number | undefined;
        if (inch != null && Number.isFinite(inch)) {
          inchValue = inch;
        } else if (cm != null && Number.isFinite(cm) && cm > 0) {
          inchValue = Math.round(cm / 2.54);
        } else {
          const fallbackInch = `${name} ${rowText}`.match(/(\d{2,3})\s*(?:인치|inch|\")/i);
          if (fallbackInch?.[1]) {
            const parsed = Number(fallbackInch[1]);
            if (Number.isFinite(parsed)) {
              inchValue = parsed;
            }
          }
        }
        const isRental = /렌탈|구독/i.test(`${name} ${rowText}`);
        const isWomenWear = /여성|여성용|우먼|women|woman|lady|레이디|여자/i.test(`${name} ${rowText}`);
        const isHikingWear = /등산|아웃도어|트레킹|하이킹|mountain|hiking/i.test(`${name} ${rowText}`);
        const isRed = /레드|빨강|빨간|붉은|red/i.test(`${name} ${rowText}`);

        let lumpSumValue = 0;
        let lumpSumLabel = '정보 없음';
        const priceNodes = Array.from(
          node.querySelectorAll('p.price_sect a strong, p.price_sect strong, .price_info .price_num')
        );
        for (const priceNode of priceNodes) {
          const text = String(priceNode.textContent ?? '').replace(/\s+/g, ' ').trim();
          const matched = text.match(/\d[\d,]*/);
          if (!matched?.[0]) {
            continue;
          }
          const candidate = Number(matched[0].replace(/,/g, ''));
          if (Number.isFinite(candidate) && candidate >= 1_000 && (lumpSumValue === 0 || candidate < lumpSumValue)) {
            lumpSumValue = candidate;
            lumpSumLabel = `${matched[0]}원`;
          }
        }
        if (lumpSumValue === 0) {
          for (const matched of rowText.matchAll(/(?:최저가\s*)?(\d[\d,]{3,})\s*원/g)) {
            const numeric = Number((matched[1] ?? '').replace(/,/g, ''));
            if (Number.isFinite(numeric) && numeric >= 1_000 && (lumpSumValue === 0 || numeric < lumpSumValue)) {
              lumpSumValue = numeric;
              lumpSumLabel = `${matched[1]}원`;
            }
          }
        }
        if (lumpSumValue === 0) {
          const wonMatches = rowText.match(/\d[\d,]{4,}\s*원/g) ?? [];
          for (const won of wonMatches) {
            const matched = won.match(/\d[\d,]*/);
            if (!matched?.[0]) {
              continue;
            }
            const candidate = Number(matched[0].replace(/,/g, ''));
            if (Number.isFinite(candidate) && candidate >= 1_000 && (lumpSumValue === 0 || candidate < lumpSumValue)) {
              lumpSumValue = candidate;
              lumpSumLabel = `${matched[0]}원`;
            }
          }
        }

        let installmentMonthlyValue = 0;
        let installmentMonths: number | undefined;
        let installmentTotalValue = 0;
        let installmentLabel = '정보 없음';
        const monthly = rowText.match(/월\s*([\d,]+)\s*원/i);
        if (monthly?.[1]) {
          installmentMonthlyValue = Number(monthly[1].replace(/,/g, ''));
          installmentLabel = `월 ${monthly[1]}원`;
          const monthsMatch = rowText.match(/(\d{1,3})\s*개월/);
          if (monthsMatch?.[1]) {
            installmentMonths = Number(monthsMatch[1]);
          }
        } else {
          const monthlyAlt = rowText.match(/(\d{1,3})\s*개월\s*([\d,]{3,})/);
          if (monthlyAlt?.[1] && monthlyAlt?.[2]) {
            installmentMonths = Number(monthlyAlt[1]);
            installmentMonthlyValue = Number(monthlyAlt[2].replace(/,/g, ''));
            installmentLabel = `월 ${monthlyAlt[2]}원`;
          }
        }
        if (
          Number.isFinite(installmentMonthlyValue) &&
          installmentMonthlyValue > 0 &&
          Number.isFinite(installmentMonths) &&
          (installmentMonths ?? 0) > 0
        ) {
          installmentTotalValue = installmentMonthlyValue * (installmentMonths ?? 0);
          installmentLabel = `${installmentMonths}개월 x ${installmentMonthlyValue.toLocaleString()}원 = ${installmentTotalValue.toLocaleString()}원`;
        }
        if (!Number.isFinite(installmentMonthlyValue)) {
          installmentMonthlyValue = 0;
        }
        if (!Number.isFinite(installmentTotalValue)) {
          installmentTotalValue = 0;
        }

        const priceBasis: 'lump_sum' | 'installment' | 'unknown' =
          lumpSumValue > 0 ? 'lump_sum' : installmentMonthlyValue > 0 ? 'installment' : 'unknown';
        const sortPrice =
          lumpSumValue > 0
            ? lumpSumValue
            : installmentTotalValue > 0
              ? installmentTotalValue
              : installmentMonthlyValue > 0
                ? installmentMonthlyValue
                : Number.MAX_SAFE_INTEGER;

        rows.push({
          name,
          lumpSumLabel,
          lumpSumValue,
          installmentLabel,
          installmentMonthlyValue,
          installmentMonths,
          installmentTotalValue,
          priceBasis,
          sortPrice,
          inchValue,
          isRental,
          isWomenWear,
          isHikingWear,
          isRed,
          source,
          domIndex: nodeIndex
        });
      }

      const hasStrictFilters =
        options.requireWomenWear === true ||
        options.requireHikingWear === true ||
        options.requireRedColor === true ||
        (typeof options.maxLumpSum === 'number' && Number.isFinite(options.maxLumpSum));

      let candidates = rows.filter((row) => {
        if (options.excludeRental && row.isRental) {
          return false;
        }
        if (options.requireWomenWear && !row.isWomenWear) {
          return false;
        }
        if (options.requireHikingWear && !row.isHikingWear) {
          return false;
        }
        if (options.requireRedColor && !row.isRed) {
          return false;
        }
        if (
          typeof options.maxLumpSum === 'number' &&
          Number.isFinite(options.maxLumpSum)
        ) {
          if (row.lumpSumValue <= 0) {
            return false;
          }
          if (row.lumpSumValue > options.maxLumpSum) {
            return false;
          }
        }
        return true;
      });

      if (
        !hasStrictFilters &&
        typeof preferredInchValue === 'number'
      ) {
        const preferredInch = candidates.filter(
          (row) =>
            typeof row.inchValue === 'number' &&
            Number.isFinite(row.inchValue) &&
            Math.abs(row.inchValue - preferredInchValue) <= 1
        );
        if (preferredInch.length > 0) {
          candidates = preferredInch;
        }
      } else if (!hasStrictFilters && candidates.length === 0) {
        candidates = rows;
      }

      candidates.sort((left, right) => {
        if (typeof preferredInchValue === 'number') {
          const leftDiff =
            typeof left.inchValue === 'number' && Number.isFinite(left.inchValue)
              ? Math.abs(left.inchValue - preferredInchValue)
              : Number.MAX_SAFE_INTEGER;
          const rightDiff =
            typeof right.inchValue === 'number' && Number.isFinite(right.inchValue)
              ? Math.abs(right.inchValue - preferredInchValue)
              : Number.MAX_SAFE_INTEGER;
          if (leftDiff !== rightDiff) {
            return leftDiff - rightDiff;
          }
        }
        if (left.sortPrice !== right.sortPrice) {
          return left.sortPrice - right.sortPrice;
        }
        if (left.isRental !== right.isRental) {
          return left.isRental ? 1 : -1;
        }
        return left.name.localeCompare(right.name);
      });

      return candidates.slice(0, Math.max(1, limit));
    }, {
      limit: Math.max(1, maxItems),
      filter: filter ?? {}
    });
  }

  private listingCardSelector(source: ListingProductRow['source']): string {
    return source === 'prod_list'
      ? '.main_prodlist_list > ul > li.prod_item, li.prod_item'
      : '.prod_main_info';
  }

  private async captureListingTiles(rows: ListingProductRow[], maxTiles: number): Promise<CompositeSourceImage[]> {
    const page = this.requirePage();
    if (!this.screenshotDir) {
      return [];
    }

    const images: CompositeSourceImage[] = [];
    const limited = rows.slice(0, Math.max(1, maxTiles));
    for (let index = 0; index < limited.length; index += 1) {
      const row = limited[index]!;
      const id = `tile-${index + 1}`;
      const path = join(this.screenshotDir, `listing-tile-${String(index + 1).padStart(2, '0')}.png`);
      try {
        const locator = page.locator(this.listingCardSelector(row.source)).nth(row.domIndex);
        await locator.scrollIntoViewIfNeeded();
        await locator.screenshot({ path });
        images.push({
          id,
          imagePath: path,
          metadata: {
            name: row.name
          }
        });
      } catch {
        continue;
      }
    }
    return images;
  }

  private async computeRedScore(imagePath: string): Promise<number> {
    try {
      const image = await Jimp.read(imagePath);
      const { width, height, data } = image.bitmap;
      if (width <= 0 || height <= 0) {
        return 0;
      }
      let redPixels = 0;
      let sampled = 0;
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const index = (y * width + x) * 4;
          const r = data[index] ?? 0;
          const g = data[index + 1] ?? 0;
          const b = data[index + 2] ?? 0;
          const max = Math.max(r, g, b);
          const min = Math.min(r, g, b);
          const diff = max - min;
          if (max <= 0 || diff <= 0) {
            sampled += 1;
            continue;
          }
          const sat = diff / max;
          const value = max / 255;

          let hue = 0;
          if (max === r) {
            hue = ((g - b) / diff) % 6;
          } else if (max === g) {
            hue = (b - r) / diff + 2;
          } else {
            hue = (r - g) / diff + 4;
          }
          hue *= 60;
          if (hue < 0) {
            hue += 360;
          }

          if ((hue >= 345 || hue <= 25) && sat >= 0.22 && value >= 0.18) {
            redPixels += 1;
          }
          sampled += 1;
        }
      }

      if (sampled === 0) {
        return 0;
      }
      return redPixels / sampled;
    } catch {
      return 0;
    }
  }

  private visualCompositeEnabled(): boolean {
    return parseBoolean(process.env.CHAT_AUTOMATION_VISUAL_REPEAT_ENABLED ?? '1');
  }

  private visualTileLimit(defaultMaxItems: number): number {
    const configured = parseOptionalNumber(process.env.CHAT_AUTOMATION_VISUAL_TILE_LIMIT);
    if (!configured || !Number.isFinite(configured)) {
      return Math.max(12, defaultMaxItems * 6);
    }
    return Math.min(48, Math.max(6, Math.floor(configured)));
  }

  private async decideVisualListingOrder(
    products: ListingProductRow[],
    maxItems: number,
    filter: ListingProductFilter | undefined
  ): Promise<ListingVisualDecision | undefined> {
    if (!filter?.requireRedColor) {
      return undefined;
    }
    if (!this.visualCompositeEnabled()) {
      return {
        orderedProducts: products.slice(0, Math.max(1, maxItems)),
        evidenceLines: ['Visual repeated-item analysis: skipped (feature disabled).']
      };
    }
    if (products.length === 0) {
      return {
        orderedProducts: [],
        evidenceLines: ['Visual repeated-item analysis: skipped (no textual listing candidates).']
      };
    }
    if (!this.screenshotDir) {
      return {
        orderedProducts: products.slice(0, Math.max(1, maxItems)),
        evidenceLines: ['Visual repeated-item analysis: skipped (runtime screenshot directory unavailable).']
      };
    }

    const tileLimit = this.visualTileLimit(maxItems);
    const tileRows = products.slice(0, tileLimit);
    const tileImages = await this.captureListingTiles(tileRows, tileLimit);
    if (tileImages.length === 0) {
      return {
        orderedProducts: products,
        evidenceLines: ['Visual repeated-item analysis: skipped (no capturable tiles).']
      };
    }

    const compositeImagePath = join(this.screenshotDir, `listing-composite-${Date.now()}.png`);
    const compositeManifestPath = `${compositeImagePath}.manifest.json`;

    const judgement = await executeRepeatedItemJudgement({
      images: tileImages,
      outputImagePath: compositeImagePath,
      outputManifestPath: compositeManifestPath,
      runYolo: async ({ compositeImagePath: imagePath }) => {
        const result = await runRfDetrLocal({
          imagePath,
          labels: ['shirt', 'jacket', 'coat', 'hoodie', 'dress', 'pants', 'apparel', 'clothing', 'person']
        });
        return {
          detections: result.detections,
          accepted: result.accepted,
          reason: result.reason
        };
      }
    });

    const rowByTileId = new Map<string, ListingProductRow>();
    tileRows.forEach((row, index) => {
      rowByTileId.set(`tile-${index + 1}`, row);
    });

    const detectorMatchedSourceIds = new Set(
      judgement.mappedDetections
        .filter((item) => item.matched && item.sourceId)
        .map((item) => item.sourceId as string)
    );

    const ranked = [];
    for (let index = 0; index < tileImages.length; index += 1) {
      const image = tileImages[index]!;
      const row = rowByTileId.get(image.id);
      if (!row) {
        continue;
      }
      const redScore = await this.computeRedScore(image.imagePath);
      const detectorBoost = detectorMatchedSourceIds.has(image.id) ? 0.24 : 0;
      const textBoost = row.isRed ? 0.08 : 0;
      const score = redScore + detectorBoost + textBoost;
      ranked.push({
        row,
        score,
        redScore,
        detectorMatched: detectorMatchedSourceIds.has(image.id)
      });
    }

    ranked.sort((left, right) => right.score - left.score);
    const strong = ranked.filter((entry) => entry.redScore >= 0.06 || entry.score >= 0.14);
    const selectedRows = (strong.length > 0 ? strong : ranked).slice(0, Math.max(1, maxItems));

    const selectedNameSet = new Set(selectedRows.map((entry) => entry.row.name.toLowerCase()));
    const remaining = products.filter((row) => !selectedNameSet.has(row.name.toLowerCase()));
    const orderedProducts = [...selectedRows.map((entry) => entry.row), ...remaining].slice(
      0,
      Math.max(1, maxItems)
    );

    const evidenceLines = [
      `Visual repeated-item analysis: tiles=${tileImages.length}, rfDetrDetections=${judgement.yolo.detections.length}, rfDetrAccepted=${judgement.yoloAccepted}, rfDetrReason=${judgement.yoloDecisionReason}.`,
      `Visual composite: ${judgement.compositeImagePath}`,
      ...selectedRows.slice(0, 3).map((entry, index) =>
        `Visual rank ${index + 1}: ${entry.row.name} (score=${entry.score.toFixed(3)}, red=${entry.redScore.toFixed(
          3
        )}, rfDetrMatched=${entry.detectorMatched})`
      )
    ];

    return {
      orderedProducts,
      evidenceLines
    };
  }

  async summarizeCurrentPage(maxHeadlines = 5, options?: PageSummaryOptions): Promise<string> {
    const page = this.requirePage();
    const maxRetries = 3;

    for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
      await ignore(page.waitForLoadState('domcontentloaded', { timeout: 20_000 }));
      await ignore(page.waitForTimeout(250));

      try {
        const title = normalizeText(await page.title());
        const url = page.url();
        const listingOptions = options?.listing;
        const listingFilter = listingOptions?.filter;
        const visualListingFilter =
          listingFilter?.requireRedColor === true
            ? {
                ...listingFilter,
                requireRedColor: false
              }
            : listingFilter;
        const listingLimit =
          listingFilter?.requireRedColor === true
            ? Math.max(maxHeadlines * 6, 24)
            : maxHeadlines;
        let usedRelaxedVisualCandidates = false;
        let products = await this.summarizeListingProducts(listingLimit, visualListingFilter);
        if (listingFilter?.requireRedColor === true && products.length === 0) {
          const relaxedFilter = {
            ...(visualListingFilter ?? {}),
            requireWomenWear: false,
            requireHikingWear: false
          };
          const relaxed = await this.summarizeListingProducts(listingLimit, relaxedFilter);
          if (relaxed.length > 0) {
            products = relaxed;
            usedRelaxedVisualCandidates = true;
          }
        }
        const visualDecision = await this.decideVisualListingOrder(products, maxHeadlines, listingFilter);
        if (visualDecision) {
          products = visualDecision.orderedProducts;
        } else if (products.length > maxHeadlines) {
          products = products.slice(0, Math.max(1, maxHeadlines));
        }
        const hasPriceBearingRows = products.some(
          (product) => product.lumpSumValue > 0 || product.installmentMonthlyValue > 0
        );
        if (hasPriceBearingRows || listingOptions?.modeLabel || listingOptions?.filter) {
          const lines = [`Current page: ${title || '(no title)'}`, `URL: ${url}`];
          if (visualDecision?.evidenceLines.length) {
            lines.push(...visualDecision.evidenceLines);
          }
          if (listingOptions?.modeLabel) {
            lines.push(`Mode: ${listingOptions.modeLabel}`);
          }
          const filterNotes: string[] = [];
          if (typeof listingOptions?.filter?.preferInch === 'number') {
            filterNotes.push(`prefer ${listingOptions.filter.preferInch}-inch`);
          }
          if (listingOptions?.filter?.requireWomenWear) {
            filterNotes.push('require women wear');
          }
          if (listingOptions?.filter?.requireHikingWear) {
            filterNotes.push('require hiking wear');
          }
          if (listingOptions?.filter?.requireRedColor) {
            filterNotes.push('require red color');
          }
          if (typeof listingOptions?.filter?.maxLumpSum === 'number') {
            filterNotes.push(`max lump sum ${listingOptions.filter.maxLumpSum.toLocaleString()} KRW`);
          }
          if (filterNotes.length > 0) {
            lines.push(`Applied filters: ${filterNotes.join(', ')}`);
          }
          if (usedRelaxedVisualCandidates) {
            lines.push('Visual candidate pool used relaxed text constraints (women/hiking) to avoid empty-grid analysis.');
          }
          if (products.length > 0) {
            lines.push('Top candidates:');
            products.forEach((product, index) => {
              lines.push(`${index + 1}. ${product.name}`);
              lines.push(`   - Lump sum: ${product.lumpSumLabel}`);
              lines.push(`   - Installment: ${product.installmentLabel}`);
              lines.push(
                `   - Price basis: ${
                  product.priceBasis === 'lump_sum'
                    ? 'lump_sum'
                    : product.priceBasis === 'installment'
                      ? 'installment'
                      : 'unknown'
                }`
              );
            });
          } else {
            lines.push('No candidates matched the requested filters on this page.');
          }
          return lines.join('\n');
        }
        const headlines = await this.summarizeHeadlines(maxHeadlines);
        const lines = [`Current page: ${title || '(no title)'}`, `URL: ${url}`];
        if (headlines.length > 0) {
          lines.push('Key items:');
          headlines.forEach((headline, index) => {
            lines.push(`${index + 1}. ${headline}`);
          });
        }
        return lines.join('\n');
      } catch (error) {
        if (!isTransientNavigationError(error) || attempt >= maxRetries) {
          throw error;
        }
        await ignore(page.waitForTimeout(600));
      }
    }

    throw new Error('summary retries exhausted');
  }

  async close(): Promise<void> {
    const context = this.context;
    const browser = this.browser;
    this.page = undefined;
    this.context = undefined;
    this.browser = undefined;
    if (context) {
      await context.close();
    }
    if (browser) {
      await browser.close();
    }
  }
}
