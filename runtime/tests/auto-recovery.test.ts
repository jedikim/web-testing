import { describe, expect, it } from 'vitest';

import { executeWithSelectorRecovery } from '../src/fallback/auto-recovery';
import type { CandidateItem } from '../src/fallback/context-reducer';
import type { SelectorRecipe } from '../src/fallback/recipe-version';

describe('executeWithSelectorRecovery', () => {
  it('recovers selector-not-found by applying patch and rerunning', async () => {
    const initial: SelectorRecipe = {
      workflowId: 'shopping_search_v01',
      version: 'v001',
      selectors: {
        search_input: { css: '#old-search', updatedAt: '2026-02-24T00:00:00Z' }
      }
    };

    let attempts = 0;
    const result = await executeWithSelectorRecovery({
      recipe: initial,
      run: async (recipe) => {
        attempts += 1;
        if (recipe.selectors.search_input?.css === '#old-search') {
          return {
            status: 'fail',
            failureCode: 'SelectorNotFound',
            candidates: [
              { id: 'c1', role: 'textbox', text: 'Search', score: 0.9, bbox: [0, 0, 10, 10] }
            ],
            proposedPatch: {
              target: 'selectors',
              reason: 'selector changed',
              operations: [
                {
                  op: 'replace',
                  path: '/selectors/search_input',
                  value: { css: '#new-search' }
                }
              ]
            }
          };
        }
        return { status: 'pass' };
      }
    });

    expect(result.status).toBe('pass');
    expect(result.recipe.version).toBe('v002');
    expect(result.recipe.selectors.search_input?.css).toBe('#new-search');
    expect(result.llmCalls).toBe(1);
    expect(attempts).toBe(2);
  });

  it('recovers selector-not-found with Similo fingerprint match before llm patch', async () => {
    const initial: SelectorRecipe = {
      workflowId: 'shopping_search_v01',
      version: 'v001',
      selectors: {
        search_input: {
          css: '#old-search',
          updatedAt: '2026-02-24T00:00:00Z',
          fingerprint: {
            text: '검색',
            role: 'textbox',
            classTokens: ['search-box'],
            idHint: 'query',
            nearbyText: ['통합검색']
          }
        }
      }
    };

    let attempts = 0;
    const result = await executeWithSelectorRecovery({
      recipe: initial,
      similoEnabled: true,
      run: async (recipe) => {
        attempts += 1;
        if (recipe.selectors.search_input?.css === '#old-search') {
          return {
            status: 'fail',
            failureCode: 'SelectorNotFound',
            candidates: [
              {
                id: 'query',
                role: 'textbox',
                text: '검색어를 입력하세요',
                score: 0.4,
                bbox: [0.1, 0.1, 0.8, 0.1],
                attributes: {
                  css: 'input#query.search-box',
                  class: 'search-box primary',
                  nearbyText: '통합검색|실시간'
                }
              }
            ]
          };
        }
        return { status: 'pass' };
      }
    });

    expect(result.status).toBe('pass');
    expect(result.recipe.version).toBe('v002');
    expect(result.recipe.selectors.search_input?.css).toBe('input#query.search-box');
    expect(result.llmCalls).toBe(0);
    expect(result.similoRecoveries).toBe(1);
    expect(attempts).toBe(2);
  });

  it('builds structure-first candidate context with optional semantic rerank before llm patch', async () => {
    const initial: SelectorRecipe = {
      workflowId: 'shopping_login_v01',
      version: 'v001',
      selectors: {
        login_button: { css: '#old-login', updatedAt: '2026-02-24T00:00:00Z' }
      }
    };

    const candidates: CandidateItem[] = Array.from({ length: 120 }).map((_, index) => ({
      id: `generic-${index}`,
      role: 'button',
      text: `일반 버튼 ${index}`,
      score: 0.9 - index * 0.001,
      bbox: [0, 100 + index, 100, 20] as [number, number, number, number]
    }));
    candidates.push({
      id: 'login-new',
      role: 'button',
      text: '로그인',
      score: 0.1,
      bbox: [0, 20, 100, 20],
      attributes: {
        class: 'btn login',
        tag: 'button'
      }
    });

    let embedCallInputs = 0;
    let builtContextSize = 0;

    const result = await executeWithSelectorRecovery({
      recipe: initial,
      candidateContext: {
        intent: 'login',
        query: '로그인 버튼',
        maxCandidates: 6,
        structureFirstLimit: 30,
        semanticRerank: {
          enabled: true,
          query: '로그인 버튼',
          vectorBackend: 'bruteforce',
          embed: async (texts) => {
            embedCallInputs += texts.length;
            return texts.map((text) => (/로그인/i.test(text) ? [1, 0] : [0, 1]));
          }
        },
        onBuilt: async (context) => {
          builtContextSize = context.candidates.length;
        }
      },
      run: async (recipe) => {
        if (recipe.selectors.login_button?.css === '#old-login') {
          return {
            status: 'fail',
            failureCode: 'SelectorNotFound',
            candidates,
            proposedPatch: {
              target: 'selectors',
              reason: 'selector changed',
              operations: [
                {
                  op: 'replace',
                  path: '/selectors/login_button',
                  value: { css: '#new-login' }
                }
              ]
            }
          };
        }
        return { status: 'pass' };
      }
    });

    expect(result.status).toBe('pass');
    expect(result.semanticRerankCalls).toBe(1);
    expect(result.reducedCandidateCount).toBeLessThanOrEqual(6);
    expect(result.embeddedCandidateCount).toBeLessThanOrEqual(30);
    expect(embedCallInputs).toBeLessThanOrEqual(31);
    expect(builtContextSize).toBeGreaterThan(0);
  });
});
