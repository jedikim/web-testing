import type { Action, DOMNode, ScoredNode, StepPlan } from './types';

export interface ResolvedViewport {
  xy?: [number, number];
  bbox?: [number, number, number, number];
}

export interface ViewportResolver {
  resolve(node: DOMNode, selector: string | null): Promise<ResolvedViewport | undefined>;
}

function sanitizeSelectorToken(raw: string): string {
  return raw.replace(/([ #;?%&,.+*~':"!^$[\]()=>|/@])/g, '\\$1');
}

function selectorFromNode(node: DOMNode): string | null {
  const id = node.attrs.id?.trim();
  if (id) {
    return `#${sanitizeSelectorToken(id)}`;
  }

  const name = node.attrs.name?.trim();
  if (name) {
    return `[name="${name.replace(/"/g, '\\"')}"]`;
  }

  const ariaLabel = node.attrs['aria-label']?.trim();
  if (ariaLabel) {
    return `[aria-label="${ariaLabel.replace(/"/g, '\\"')}"]`;
  }

  const className = node.attrs.class?.trim().split(/\s+/).find((value) => value.length > 0);
  if (className) {
    return `${node.tag}.${sanitizeSelectorToken(className)}`;
  }

  if (node.tag && node.tag !== 'unknown') {
    return node.tag;
  }

  return null;
}

export class Actor {
  async decide(step: StepPlan, candidates: ScoredNode[], resolver?: ViewportResolver): Promise<Action> {
    const best = candidates[0];
    if (!best) {
      return {
        selector: null,
        actionType: step.actionType,
        value: step.value,
        viewportXY: step.targetViewportXY
      };
    }

    const selector = selectorFromNode(best.node);
    const resolved = resolver ? await resolver.resolve(best.node, selector) : undefined;

    return {
      selector,
      actionType: step.actionType,
      value: step.value,
      viewportXY: resolved?.xy ?? step.targetViewportXY,
      viewportBbox: resolved?.bbox
    };
  }
}
