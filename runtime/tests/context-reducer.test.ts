import { describe, expect, it } from 'vitest';

import {
  buildCandidateContext,
  buildCandidateContextWithSemanticRerank,
  PageScopedEmbeddingCache,
  type CandidateItem
} from '../src/fallback/context-reducer';

describe('buildCandidateContext', () => {
  it('sorts candidates by score and limits count', () => {
    const items: CandidateItem[] = [
      {
        id: 'a',
        role: 'button',
        text: 'A',
        score: 0.1,
        bbox: [0, 0, 10, 10]
      },
      {
        id: 'b',
        role: 'button',
        text: 'B',
        score: 0.9,
        bbox: [0, 0, 20, 20]
      },
      {
        id: 'c',
        role: 'button',
        text: 'C',
        score: 0.5,
        bbox: [0, 0, 30, 30]
      }
    ];

    const context = buildCandidateContext(items, 2);
    expect(context.candidates.map((x) => x.id)).toEqual(['b', 'c']);
  });

  it('drops heavy attributes not needed for selector selection', () => {
    const items: CandidateItem[] = [
      {
        id: 'n1',
        role: 'textbox',
        text: 'Search',
        score: 0.8,
        bbox: [1, 2, 3, 4],
        attributes: { html: '<input ...>' }
      }
    ];

    const context = buildCandidateContext(items, 5);
    expect(context.candidates[0]).toEqual({
      id: 'n1',
      role: 'textbox',
      text: 'Search',
      score: 0.8,
      bbox: [1, 2, 3, 4]
    });
  });

  it('prioritizes structural menu/login/search hints before semantic rerank', () => {
    const items: CandidateItem[] = [];
    for (let i = 0; i < 200; i += 1) {
      items.push({
        id: `generic-${i}`,
        role: 'div',
        text: `row-${i}`,
        score: 0.9 - i * 0.001,
        bbox: [10, 500 + i, 100, 30]
      });
    }
    items.push({
      id: 'menu-toggle',
      role: 'button',
      text: '전체 메뉴',
      score: 0.12,
      bbox: [10, 20, 80, 30],
      attributes: {
        tag: 'button',
        class: 'hamburger menu-toggle',
        'aria-expanded': 'false'
      }
    });

    const context = buildCandidateContext(items, {
      intent: 'menu',
      query: '햄버거 메뉴 버튼',
      maxCandidates: 5,
      structureFirstLimit: 30
    });

    expect(context.candidates.map((candidate) => candidate.id)).toContain('menu-toggle');
    expect(context.metadata?.structureFirstPoolSize).toBeLessThanOrEqual(30);
  });

  it('uses semantic rerank on reduced pool only and keeps embedding bounded', async () => {
    const items: CandidateItem[] = [];
    for (let i = 0; i < 1000; i += 1) {
      items.push({
        id: `item-${i}`,
        role: 'button',
        text: `일반 버튼 ${i}`,
        score: 1 - i * 0.0005,
        bbox: [0, i, 100, 20]
      });
    }
    items.push({
      id: 'login-target',
      role: 'button',
      text: '로그인',
      score: 0.05,
      bbox: [0, 20, 100, 20],
      attributes: {
        class: 'btn login'
      }
    });

    let embeddedTexts = 0;
    const context = await buildCandidateContextWithSemanticRerank(items, {
      intent: 'login',
      query: '로그인 버튼',
      maxCandidates: 3,
      structureFirstLimit: 40,
      semanticRerank: {
        query: '로그인 버튼',
        vectorBackend: 'bruteforce',
        embed: async (texts) => {
          embeddedTexts += texts.length;
          return texts.map((text) =>
            /로그인/i.test(text)
              ? [1, 0, 0]
              : /버튼/i.test(text)
                ? [0.4, 0.6, 0]
                : [0, 1, 0]
          );
        }
      }
    });

    expect(context.candidates[0]?.id).toBe('login-target');
    expect(context.metadata?.strategy).toBe('structure_plus_semantic');
    expect(embeddedTexts).toBeLessThanOrEqual(41);
    expect(context.metadata?.embeddedCandidateCount).toBeLessThanOrEqual(40);
  });

  it('reuses page-scoped embedding cache for repeated rerank on same candidate set', async () => {
    const cache = new PageScopedEmbeddingCache();
    const items: CandidateItem[] = [
      {
        id: 'search-box',
        role: 'textbox',
        text: '검색',
        score: 0.2,
        bbox: [0, 20, 100, 30],
        attributes: {
          tag: 'input',
          placeholder: '검색어를 입력하세요'
        }
      },
      {
        id: 'menu-link',
        role: 'link',
        text: '전체 메뉴',
        score: 0.15,
        bbox: [0, 10, 100, 20]
      }
    ];

    let callCount = 0;
    const embed = async (texts: string[]): Promise<number[][]> => {
      callCount += 1;
      return texts.map((text) =>
        /검색/i.test(text) ? [1, 0] : [0, 1]
      );
    };

    const first = await buildCandidateContextWithSemanticRerank(items, {
      intent: 'search',
      query: '검색 입력창',
      maxCandidates: 1,
      structureFirstLimit: 10,
      semanticRerank: {
        query: '검색 입력창',
        pageKey: 'page:search',
        cache,
        embed
      }
    });

    const second = await buildCandidateContextWithSemanticRerank(items, {
      intent: 'search',
      query: '검색 입력창',
      maxCandidates: 1,
      structureFirstLimit: 10,
      semanticRerank: {
        query: '검색 입력창',
        pageKey: 'page:search',
        cache,
        embed
      }
    });

    expect(first.candidates[0]?.id).toBe('search-box');
    expect(second.candidates[0]?.id).toBe('search-box');
    expect(callCount).toBe(1);
    expect(second.metadata?.embeddedCandidateCount).toBe(0);
  });
});
