import { describe, expect, it } from 'vitest';

import { DOMExtractor, type DOMExtractClient } from '../src/v3/dom-extractor';

function makeClient(): DOMExtractClient {
  const calls: string[] = [];
  const client: DOMExtractClient = {
    async send(method: string, _params?: Record<string, unknown>): Promise<unknown> {
      calls.push(method);
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
                    nodeId: 3,
                    backendNodeId: 33,
                    nodeName: 'INPUT',
                    attributes: ['id', 'query', 'placeholder', '검색어를 입력해 주세요'],
                    children: []
                  },
                  {
                    nodeId: 4,
                    backendNodeId: 44,
                    nodeName: 'A',
                    attributes: ['href', '/shop', 'class', 'menu-link'],
                    children: [
                      {
                        nodeId: 5,
                        nodeName: '#text',
                        nodeValue: '쇼핑'
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
              backendDOMNodeId: 33,
              role: { value: 'textbox' },
              name: { value: '통합검색창' }
            },
            {
              backendDOMNodeId: 44,
              role: { value: 'link' },
              name: { value: '쇼핑 링크' }
            }
          ]
        };
      }

      throw new Error(`unexpected method: ${method}`);
    }
  };
  (client as { calls?: string[] }).calls = calls;
  return client;
}

describe('DOMExtractor', () => {
  it('extracts DOM + AX in parallel contract without snapshot calls', async () => {
    const client = makeClient();
    const extractor = new DOMExtractor();

    const nodes = await extractor.extract(client);
    const calls = (client as { calls?: string[] }).calls ?? [];

    expect(calls).toContain('DOM.getDocument');
    expect(calls).toContain('Accessibility.getFullAXTree');
    expect(calls).not.toContain('DOMSnapshot.captureSnapshot');
    expect(nodes.length).toBeGreaterThan(1);

    const search = nodes.find((row) => row.attrs.id === 'query');
    expect(search).toBeDefined();
    expect(search?.axRole).toBe('textbox');
    expect(search?.axName).toContain('검색');

    const link = nodes.find((row) => row.tag === 'a');
    expect(link?.text).toContain('쇼핑');
  });
});
