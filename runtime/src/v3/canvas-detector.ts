import type { DOMNode } from './types';

export interface CanvasPageSignal {
  totalNodes: number;
  interactiveNodes: number;
  canvasNodes: number;
}

export interface CanvasDetectionOptions {
  minCanvasNodes?: number;
  maxInteractiveRatio?: number;
}

function isInteractive(node: DOMNode): boolean {
  const role = (node.axRole ?? '').toLowerCase();
  if (role === 'button' || role === 'link' || role === 'textbox' || role === 'combobox') {
    return true;
  }
  return node.tag === 'a' || node.tag === 'button' || node.tag === 'input' || node.tag === 'textarea';
}

export class CanvasDetector {
  private readonly minCanvasNodes: number;
  private readonly maxInteractiveRatio: number;

  constructor(options: CanvasDetectionOptions = {}) {
    this.minCanvasNodes = Math.max(1, Math.floor(options.minCanvasNodes ?? 1));
    this.maxInteractiveRatio = Math.max(0.01, Math.min(1, options.maxInteractiveRatio ?? 0.12));
  }

  analyze(nodes: DOMNode[]): CanvasPageSignal {
    const totalNodes = nodes.length;
    const interactiveNodes = nodes.filter((node) => isInteractive(node)).length;
    const canvasNodes = nodes.filter((node) => node.tag === 'canvas').length;
    return {
      totalNodes,
      interactiveNodes,
      canvasNodes
    };
  }

  isCanvasHeavy(signal: CanvasPageSignal): boolean {
    if (signal.totalNodes <= 0) {
      return false;
    }
    const interactiveRatio = signal.interactiveNodes / signal.totalNodes;
    return signal.canvasNodes >= this.minCanvasNodes && interactiveRatio <= this.maxInteractiveRatio;
  }
}
