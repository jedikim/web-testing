import type { DOMNode } from './types';

export interface DOMExtractClient {
  send(method: string, params?: Record<string, unknown>): Promise<unknown>;
}

interface RawDOMNode {
  nodeId?: number;
  backendNodeId?: number;
  nodeName?: string;
  nodeValue?: string;
  attributes?: string[];
  children?: RawDOMNode[];
}

interface DOMGetDocumentPayload {
  root?: RawDOMNode;
}

interface AXProperty {
  value?: string;
}

interface AXNode {
  backendDOMNodeId?: number;
  role?: AXProperty;
  name?: AXProperty;
}

interface AXTreePayload {
  nodes?: AXNode[];
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function lowerTag(nodeName: string | undefined): string {
  if (!nodeName) {
    return 'unknown';
  }
  return nodeName.toLowerCase();
}

function toAttrs(raw: string[] | undefined): Record<string, string> {
  if (!Array.isArray(raw) || raw.length === 0) {
    return {};
  }

  const attrs: Record<string, string> = {};
  for (let index = 0; index < raw.length; index += 2) {
    const key = raw[index];
    const value = raw[index + 1];
    if (!key || value === undefined) {
      continue;
    }
    attrs[String(key)] = String(value);
  }
  return attrs;
}

function collectText(node: RawDOMNode, limit = 200): string {
  const chunks: string[] = [];

  function walk(current: RawDOMNode): void {
    if (chunks.join('').length >= limit) {
      return;
    }

    const name = lowerTag(current.nodeName);
    if (name === '#text' && current.nodeValue) {
      const value = current.nodeValue.replace(/\s+/g, ' ').trim();
      if (value.length > 0) {
        chunks.push(value);
      }
      return;
    }

    for (const child of current.children ?? []) {
      walk(child);
      if (chunks.join('').length >= limit) {
        break;
      }
    }
  }

  walk(node);
  return chunks.join(' ').slice(0, limit).trim();
}

function buildAXMap(nodes: AXNode[]): Map<number, { role?: string; name?: string }> {
  const map = new Map<number, { role?: string; name?: string }>();
  for (const node of nodes) {
    if (typeof node.backendDOMNodeId !== 'number') {
      continue;
    }
    map.set(node.backendDOMNodeId, {
      role: asString(node.role?.value),
      name: asString(node.name?.value)
    });
  }
  return map;
}

function isElementLike(node: RawDOMNode): boolean {
  const name = lowerTag(node.nodeName);
  if (!name || name.startsWith('#')) {
    return false;
  }
  return true;
}

export class DOMExtractor {
  async extract(client: DOMExtractClient): Promise<DOMNode[]> {
    const [domRaw, axRaw] = await Promise.all([
      client.send('DOM.getDocument', { depth: -1, pierce: true }),
      client.send('Accessibility.getFullAXTree')
    ]);

    const domPayload = (domRaw ?? {}) as DOMGetDocumentPayload;
    const axPayload = (axRaw ?? {}) as AXTreePayload;
    const root = domPayload.root;
    if (!root) {
      return [];
    }

    const axMap = buildAXMap(axPayload.nodes ?? []);
    const out: DOMNode[] = [];

    const walk = (node: RawDOMNode): void => {
      if (isElementLike(node)) {
        const backendNodeId = typeof node.backendNodeId === 'number' ? node.backendNodeId : undefined;
        const ax = backendNodeId ? axMap.get(backendNodeId) : undefined;
        out.push({
          nodeId: typeof node.nodeId === 'number' ? node.nodeId : -1,
          backendNodeId,
          tag: lowerTag(node.nodeName),
          text: collectText(node, 200),
          attrs: toAttrs(node.attributes),
          axRole: ax?.role,
          axName: ax?.name
        });
      }

      for (const child of node.children ?? []) {
        walk(child);
      }
    };

    walk(root);
    return out;
  }
}
