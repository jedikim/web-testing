import { describe, expect, it } from 'vitest';

import { DOMExtractor, type DOMExtractClient } from '../src/v3/dom-extractor';
import { ElementFilter } from '../src/v3/element-filter';

function naverLikeClient(): DOMExtractClient {
  return {
    async send(method: string): Promise<unknown> {
      if (method === 'DOM.getDocument') {
        return {
          root: {
            nodeId: 1,
            nodeName: 'HTML',
            children: [
              {
                nodeId: 2,
                nodeName: 'BODY',
                children: [
                  {
                    nodeId: 11,
                    backendNodeId: 111,
                    nodeName: 'HEADER',
                    attributes: ['id', 'header'],
                    children: [
                      {
                        nodeId: 21,
                        backendNodeId: 211,
                        nodeName: 'INPUT',
                        attributes: ['id', 'gnb_search', 'placeholder', '상품명 검색'],
                        children: []
                      },
                      {
                        nodeId: 22,
                        backendNodeId: 212,
                        nodeName: 'BUTTON',
                        attributes: ['aria-label', '검색'],
                        children: []
                      }
                    ]
                  },
                  {
                    nodeId: 12,
                    backendNodeId: 112,
                    nodeName: 'MAIN',
                    attributes: ['id', 'content'],
                    children: [
                      {
                        nodeId: 31,
                        backendNodeId: 311,
                        nodeName: 'A',
                        attributes: ['href', '/sports', 'class', 'menu-item'],
                        children: [{ nodeId: 41, nodeName: '#text', nodeValue: '스포츠/레저' }]
                      }
                    ]
                  }
                ]
              }
            ]
          }
        };
      }

      if (method === 'Accessibility.getFullAXTree') {
        return {
          nodes: [
            {
              backendDOMNodeId: 211,
              role: { value: 'textbox' },
              name: { value: '쇼핑 검색창' }
            },
            {
              backendDOMNodeId: 212,
              role: { value: 'button' },
              name: { value: '검색 버튼' }
            }
          ]
        };
      }

      throw new Error(`unsupported method: ${method}`);
    }
  };
}

describe('Week1-2 validation: naver shopping keyword search input', () => {
  it('finds search input as top node for keyword "검색창"', async () => {
    const extractor = new DOMExtractor();
    const filter = new ElementFilter({
      synonyms: {
        검색창: ['검색', '검색어', 'query', 'search input']
      }
    });

    const nodes = await extractor.extract(naverLikeClient());
    const ranked = filter.filter(nodes, { 검색창: 1.0 }, 10);

    expect(ranked.length).toBeGreaterThan(0);
    expect(ranked[0]?.node.tag).toBe('input');
    expect(ranked[0]?.node.attrs.id).toBe('gnb_search');
  });
});
