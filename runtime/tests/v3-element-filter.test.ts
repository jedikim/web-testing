import { describe, expect, it } from 'vitest';

import { ElementFilter } from '../src/v3/element-filter';
import type { DOMNode } from '../src/v3/types';

const nodes: DOMNode[] = [
  {
    nodeId: 1,
    tag: 'input',
    text: '',
    attrs: {
      id: 'query',
      placeholder: '검색어를 입력해 주세요',
      class: 'search_input'
    },
    axRole: 'textbox',
    axName: '통합검색'
  },
  {
    nodeId: 2,
    tag: 'a',
    text: '스포츠/레저',
    attrs: {
      href: '/sports'
    },
    axRole: 'link',
    axName: '스포츠 메뉴'
  },
  {
    nodeId: 3,
    tag: 'button',
    text: '장바구니',
    attrs: {
      class: 'cart'
    },
    axRole: 'button',
    axName: '장바구니'
  }
];

describe('ElementFilter', () => {
  it('ranks search input as top candidate when searching for 검색창', () => {
    const filter = new ElementFilter({
      synonyms: {
        검색창: ['검색', 'search', 'query']
      }
    });

    const ranked = filter.filter(nodes, { 검색창: 1.0 }, 3);
    expect(ranked.length).toBeGreaterThan(0);
    expect(ranked[0]?.node.attrs.id).toBe('query');
  });

  it('ranks sports menu for sports-related keyword weights', () => {
    const filter = new ElementFilter();
    const ranked = filter.filter(
      nodes,
      {
        스포츠: 1.0,
        레저: 0.8
      },
      2
    );

    expect(ranked[0]?.node.tag).toBe('a');
    expect(ranked[0]?.score).toBeGreaterThan(0.7);
  });
});
