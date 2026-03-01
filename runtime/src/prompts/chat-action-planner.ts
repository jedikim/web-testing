import type { VersionedPromptTemplate } from './types';

export interface ChatActionPlannerPromptInput {
  targetUrl: string;
  browserMode: 'headful' | 'headless';
  summaryCount: number;
  wantsSummary: boolean;
  listingPathHints: string[];
  hierarchyHintGroups: string[][];
  requiredKeywords: string[];
  searchQuery: string;
  searchQueryVariants: string[];
  listingFilterJson?: string;
  analysisJson: string;
  analysisGoalSummary?: string;
  analysisRecommendedStrategy?: string;
  attachmentNames: string[];
  recentLogs: string[];
}

export const CHAT_ACTION_PLANNER_PROMPT_V1: VersionedPromptTemplate<ChatActionPlannerPromptInput> = {
  id: 'chat.action_planner',
  version: 'v2',
  render(input) {
    const hints = input.listingPathHints.length > 0 ? input.listingPathHints.join(', ') : '(none)';
    const hierarchy = input.hierarchyHintGroups.length > 0
      ? input.hierarchyHintGroups.map((group, index) => `L${index + 1}: ${group.join(', ')}`).join(' | ')
      : '(none)';
    const requiredKeywords = input.requiredKeywords.length > 0 ? input.requiredKeywords.join(', ') : '(none)';
    const queryVariants = input.searchQueryVariants.length > 0 ? input.searchQueryVariants.join(' | ') : '(none)';
    const attachments = input.attachmentNames.length > 0 ? input.attachmentNames.join(', ') : '(none)';
    const recentLogs = input.recentLogs.length > 0 ? input.recentLogs.join('\n') : '(none)';
    const listingFilter = input.listingFilterJson ?? '(none)';

    return [
      'You are a web automation action planner.',
      'Input already includes a structured task analysis. Use it as primary source.',
      'Output ONLY strict JSON. No markdown. No explanation.',
      '',
      'Goal:',
      '- Build executable browser actions from structured analysis + constraints.',
      '- Prefer deterministic selectors/hints and minimal action count.',
      '- Never attempt captcha bypass. Use handoff action when security challenge appears.',
      '',
      'Allowed action kinds:',
      '- navigate: { "kind":"navigate", "url":"https://..." }',
      '- hint_navigate: { "kind":"hint_navigate", "hints":["menu","tv"], "sortPriceAsc":true|false }',
      '- click: { "kind":"click", "selectors":["..."], "textHints":["..."], "label":"..." }',
      '- type: { "kind":"type", "selectors":["..."], "textHints":["..."], "value":"...", "submit":true|false, "label":"..." }',
      '- wait: { "kind":"wait", "ms":1000 }',
      '- summarize: { "kind":"summarize", "maxItems":5 }',
      '- handoff: { "kind":"handoff", "handoffType":"captcha|security_challenge", "prompt":"..." }',
      '- noop: { "kind":"noop", "reason":"..." }',
      '',
      'Hard constraints:',
      '- actions length must be 1..18 (keep compact but allow multi-strategy retries)',
      '- use only http/https URLs',
      '- keep selector and hint strings concise',
      '- if unsure, emit noop',
      '- do not drift to unrelated hub/news/AI/event/help pages when objective is product/category listing.',
      '- for constrained shopping/listing tasks, include at least two acquisition strategies:',
      '  1) menu/category navigation strategy',
      '  2) in-site search/filter strategy',
      '- when hierarchy hint groups are provided, navigate high-level category to lower-level category step-by-step.',
      '- for strict listing filters (budget/color/gender/type), include explicit filter-probing clicks before summarize.',
      '- when hierarchy hints are strong, try menu/category route first, then search fallback if needed.',
      '- respect analysis.recommendedStrategy, but include fallback actions if first strategy may fail.',
      '',
      'Required output JSON shape:',
      '{',
      '  "actions": [ ... ],',
      '  "notes": "short optional note"',
      '}',
      '',
      `Target URL: ${input.targetUrl}`,
      `Browser mode: ${input.browserMode}`,
      `Wants summary: ${input.wantsSummary}`,
      `Summary max items: ${input.summaryCount}`,
      `Listing path hints: ${hints}`,
      `Hierarchy hint groups: ${hierarchy}`,
      `Required keywords: ${requiredKeywords}`,
      `Preferred in-site search query: ${input.searchQuery || '(none)'}`,
      `In-site search query variants: ${queryVariants}`,
      `Listing filter JSON: ${listingFilter}`,
      `Analysis goal summary: ${input.analysisGoalSummary ?? '(none)'}`,
      `Analysis recommended strategy: ${input.analysisRecommendedStrategy ?? '(none)'}`,
      `Analysis JSON: ${input.analysisJson}`,
      `Attachments: ${attachments}`,
      '',
      'Recent execution logs:',
      recentLogs
    ].join('\n');
  }
};
