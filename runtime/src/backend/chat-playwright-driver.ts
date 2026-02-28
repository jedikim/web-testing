import { mkdir } from 'node:fs/promises';
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
import type { CompositeSourceImage } from '../vision/composite-sheet';
import { executeRepeatedItemJudgement } from '../vision/repeated-item-judgement';
import { runYolo26Local } from '../vision/yolo26-local';

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

function normalizeText(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim();
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
    /Timeout .*click/i.test(message) ||
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
    objective: ActionObjective | undefined
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
    const includeMatches = includeAny.filter((token) => lowered.includes(token));
    const avoidMatches = avoidAny.filter((token) => lowered.includes(token));
    const strict = Boolean(objective.strict);
    const includeSatisfied = includeAny.length === 0 || includeMatches.length > 0;
    const avoidSafe = avoidMatches.length === 0 || includeMatches.length > 0;
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
    return this.objectiveCheckFromText(text, objective);
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

  private async collectClickableCandidates(
    hints: string[],
    options: {
      label: string;
      rootHintMode: boolean;
      wantsSearch: boolean;
      wantsFilter: boolean;
    }
  ): Promise<DomActionCandidate[]> {
    const page = this.requirePage();
    await this.clearCandidateMarkers();
    const normalizedHints = hints
      .map((hint) => normalizeText(hint.toLowerCase()))
      .filter((hint) => hint.length > 0);
    const rows = await page.evaluate(
      ({ hints, allowedRoot, options }) => {
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
          const normalizedText = text.toLowerCase();
          const rootKeywordMatched = /(카테고리|category|메뉴|navigation|nav|전체)/i.test(`${normalizedText} ${descriptor}`);
          const navigationNoiseMatched = /(ai|뉴스|news|블로그|blog|리뷰|review|가이드|guide|공지|notice|community|faq|help|문의|스토리|story|magazine|event|promo)/i.test(
            `${normalizedText} ${descriptor}`
          );
          if (!text && descriptor.length === 0) {
            continue;
          }

          const rect = element.getBoundingClientRect();
          if (rect.width <= 2 || rect.height <= 2) {
            continue;
          }
          if (rect.bottom < 0 || rect.top > window.innerHeight + 300) {
            continue;
          }

          const matched = hints.length > 0 ? hints.filter((hint) => normalizedText.includes(hint) || descriptor.includes(hint)).length : 0;
          if (hints.length > 0 && matched === 0) {
            continue;
          }

          const hrefRaw = (element as HTMLAnchorElement).href || '';
          const href = hrefRaw.trim().length > 0 ? hrefRaw.trim() : undefined;
          const targetBlank = ((element as HTMLAnchorElement).target ?? '').toLowerCase() === '_blank';
          let score = hints.length > 0 ? matched / Math.max(1, hints.length) : 0.2;

          if (element.closest('nav, header, [role="navigation"], .menu, .category, .gnb, .lnb')) {
            score += 0.28;
          }
          const hasNavigationContainer = Boolean(
            element.closest('nav, header, [role="navigation"], .menu, .category, .gnb, .lnb, [class*="menu"], [class*="cate"]')
          );
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
            const hintMatchedDirectly = hints.some((hint) => normalizedText.includes(hint) || descriptor.includes(hint));
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
        hints: normalizedHints,
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
        if (rect.bottom < 0 || rect.top > window.innerHeight + 300) {
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

  async clickFirst(selectors: string[], label: string): Promise<ClickResult> {
    const page = this.requirePage();

    for (const selector of selectors) {
      const locator = page.locator(selector).first();
      const visible = await ignore(locator.isVisible({ timeout: 2000 }));
      if (!visible) {
        continue;
      }

      const text = normalizeText((await ignore(locator.textContent())) ?? '');
      try {
        await locator.click({ timeout: 5000 });
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
        const objectiveCheck = this.candidateMatchesObjective(candidate, input.objective);
        if (!objectiveCheck.ok) {
          continue;
        }
        const locator = page.locator(candidate.selector).first();
        const visible = await ignore(locator.isVisible({ timeout: 1500 }));
        if (!visible) {
          continue;
        }
        const beforeUrl = page.url();
        const text = normalizeText((await ignore(locator.textContent())) ?? candidate.text);
        try {
          await locator.click({ timeout: 5000 });
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

      for (const selector of selectors) {
        const locator = page.locator(selector).first();
        const visible = await ignore(locator.isVisible({ timeout: 2000 }));
        if (!visible) {
          continue;
        }
        await locator.fill(value, { timeout: 7000 });
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
        intent: 'search',
        forceSemantic: true
      });

      for (const candidate of ranked.candidates.slice(0, 5)) {
        const locator = page.locator(candidate.selector).first();
        const visible = await ignore(locator.isVisible({ timeout: 1500 }));
        if (!visible) {
          continue;
        }
        await locator.fill(value, { timeout: 7000 });
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
    const maxSteps = Math.max(1, Math.floor(input.maxPathSteps ?? 3));
    const hints = pathHints.slice(0, maxSteps);

    await ignore(page.waitForTimeout(500));

    const rootHintMode = hints.some((hint) => /(카테고리|category|메뉴|전체)/i.test(hint));
    try {
      const rawCandidates = await this.collectClickableCandidates(hints, {
        label: 'hint-navigate',
        rootHintMode,
        wantsSearch: false,
        wantsFilter: false
      });
      const ranked = await this.rankCandidatesByContext(rawCandidates, {
        hints,
        label: 'hint-navigate',
        intent: rootHintMode ? 'menu' : 'navigation',
        forceSemantic: true
      });

      let clicked = false;
      for (const candidate of ranked.candidates.slice(0, 5)) {
        const objectiveCheck = this.candidateMatchesObjective(candidate, input.objective);
        if (!objectiveCheck.ok) {
          logs.push({
            level: 'warn',
            message: `Hint navigation candidate skipped by objective gate: text=${candidate.text || 'n/a'} include=${objectiveCheck.includeMatches.join('|') || 'none'} avoid=${objectiveCheck.avoidMatches.join('|') || 'none'}`
          });
          continue;
        }
        const locator = page.locator(candidate.selector).first();
        const visible = await ignore(locator.isVisible({ timeout: 1500 }));
        if (!visible) {
          continue;
        }
        const beforeUrl = page.url();
        try {
          await locator.click({ timeout: 5000 });
        } catch (error) {
          if (!isRecoverableClickError(error)) {
            throw error;
          }
          logs.push({
            level: 'warn',
            message: `Hint navigation click skipped (recoverable): text=${candidate.text || 'n/a'} selector=${candidate.selector}`
          });
          await ignore(page.waitForTimeout(420));
          continue;
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
        if (rootHintMode && looksPromotionLike(afterUrl, afterTitle)) {
          logs.push({
            level: 'warn',
            message: `Hint navigation landed on promotional page; rollback url=${afterUrl}`
          });
          await ignore(page.goBack({ waitUntil: 'domcontentloaded', timeout: 12_000 }));
          await ignore(page.waitForTimeout(300));
          continue;
        }
        const pageObjective = await this.pageMatchesObjective(input.objective);
        const rootNeedsIncludeSignal =
          rootHintMode &&
          Array.isArray(input.objective?.includeAny) &&
          (input.objective?.includeAny?.length ?? 0) > 0;
        const rootIncludeSatisfied = pageObjective.includeMatches.length > 0;
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
        if (rootNeedsIncludeSignal && !rootIncludeSatisfied) {
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

        const hrefValue = (candidate.href ?? '').trim().toLowerCase();
        const weakSamePageTransition =
          afterUrl === beforeUrl &&
          (hrefValue.length === 0 ||
            hrefValue === '#' ||
            hrefValue.endsWith('/#') ||
            hrefValue.endsWith('#') ||
            hrefValue.startsWith('javascript:'));
        if (weakSamePageTransition) {
          logs.push({
            level: 'warn',
            message: `Hint navigation weak progress via click: text=${candidate.text || hints[0] || 'n/a'} href=${candidate.href ?? 'n/a'}`
          });
          clicked = true;
          break;
        }

        logs.push({
          level: 'info',
          message: `Hint navigation "${candidate.text || hints[0] || 'n/a'}" via click: strategy=${ranked.metadata?.strategy ?? 'structure_first'} backend=${ranked.metadata?.vectorBackend ?? 'n/a'} href=${candidate.href ?? 'n/a'}`
        });
        clicked = true;
        break;
      }

      if (!clicked) {
        logs.push({
          level: 'warn',
          message: `Hint navigation skipped: no candidate for [${hints.join(', ')}]`
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
        const result = await runYolo26Local({
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

    const yoloMatchedSourceIds = new Set(
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
      const yoloBoost = yoloMatchedSourceIds.has(image.id) ? 0.24 : 0;
      const textBoost = row.isRed ? 0.08 : 0;
      const score = redScore + yoloBoost + textBoost;
      ranked.push({
        row,
        score,
        redScore,
        yoloMatched: yoloMatchedSourceIds.has(image.id)
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
      `Visual repeated-item analysis: tiles=${tileImages.length}, yoloDetections=${judgement.yolo.detections.length}, yoloAccepted=${judgement.yoloAccepted}, yoloReason=${judgement.yoloDecisionReason}.`,
      `Visual composite: ${judgement.compositeImagePath}`,
      ...selectedRows.slice(0, 3).map((entry, index) =>
        `Visual rank ${index + 1}: ${entry.row.name} (score=${entry.score.toFixed(3)}, red=${entry.redScore.toFixed(
          3
        )}, yoloMatched=${entry.yoloMatched})`
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
