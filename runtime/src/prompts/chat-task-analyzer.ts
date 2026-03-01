import type { VersionedPromptTemplate } from './types';

export interface ChatTaskAnalyzerPromptInput {
  userMessage: string;
  targetUrl: string;
  browserMode: 'headful' | 'headless';
  listingPathHints: string[];
  requiredKeywords: string[];
  searchQuery: string;
  listingFilterJson?: string;
  attachmentNames: string[];
  recentLogs: string[];
}

export const CHAT_TASK_ANALYZER_PROMPT_V1: VersionedPromptTemplate<ChatTaskAnalyzerPromptInput> = {
  id: 'chat.task_analyzer',
  version: 'v1',
  render(input) {
    const listingHints = input.listingPathHints.length > 0 ? input.listingPathHints.join(', ') : '(none)';
    const requiredKeywords = input.requiredKeywords.length > 0 ? input.requiredKeywords.join(', ') : '(none)';
    const attachments = input.attachmentNames.length > 0 ? input.attachmentNames.join(', ') : '(none)';
    const recentLogs = input.recentLogs.length > 0 ? input.recentLogs.join('\n') : '(none)';
    const listingFilter = input.listingFilterJson ?? '(none)';

    return [
      'You are a web automation requirement analyst.',
      'Do NOT output execution actions yet. First classify and decompose the request.',
      'Output ONLY strict JSON. No markdown. No explanation.',
      '',
      'Required output JSON shape:',
      '{',
      '  "taskType": "short string",',
      '  "siteType": "short string",',
      '  "goalSummary": "single sentence",',
      '  "constraintBuckets": {',
      '    "must": ["..."],',
      '    "prefer": ["..."],',
      '    "avoid": ["..."]',
      '  },',
      '  "stagedApproach": ["step 1", "step 2", "step 3"],',
      '  "strategyOptions": [',
      '    {',
      '      "name": "menu_first|search_first|hybrid|other",',
      '      "whenToUse": "short condition",',
      '      "steps": ["..."],',
      '      "risks": ["..."]',
      '    }',
      '  ],',
      '  "recommendedStrategy": "strategy name",',
      '  "strategyRationale": "short reason",',
      '  "confidence": 0.0',
      '}',
      '',
      'Policy:',
      '- Derive multiple viable browsing strategies, not just one.',
      '- Classify the request into objective, constraints, and browsing stages before choosing strategy.',
      '- Choose menu_first when menu/category traversal is explicit OR category hierarchy constraints are strong.',
      '- For strict multi-constraint shopping tasks (category + color + budget + item type), prefer hybrid (menu-first then search fallback).',
      '- For each strategy option, include at least one concrete failure risk and fallback trigger.',
      '- Include fallback strategy that uses in-site search/filter.',
      '- Never propose captcha bypass. Human handoff only for captcha/security.',
      '- Keep strings concise and concrete.',
      '',
      `User message: ${input.userMessage}`,
      `Target URL: ${input.targetUrl}`,
      `Browser mode: ${input.browserMode}`,
      `Listing path hints: ${listingHints}`,
      `Required keywords: ${requiredKeywords}`,
      `Search query seed: ${input.searchQuery || '(none)'}`,
      `Listing filter JSON: ${listingFilter}`,
      `Attachments: ${attachments}`,
      '',
      'Recent execution logs:',
      recentLogs
    ].join('\n');
  }
};
