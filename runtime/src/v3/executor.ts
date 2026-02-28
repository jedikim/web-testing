import type { Action } from './types';

export interface ExecutorBrowser {
  clickSelector(selector: string, timeoutMs?: number): Promise<void>;
  fillSelector(selector: string, value: string): Promise<void>;
  mouseClick(x: number, y: number): Promise<void>;
  typeText(value: string): Promise<void>;
  getViewportSize(): Promise<{ width: number; height: number }>;
}

function toAbsolutePoint(
  viewportXY: [number, number],
  viewport: { width: number; height: number }
): [number, number] {
  const x = Math.max(0, Math.round(viewportXY[0] * viewport.width));
  const y = Math.max(0, Math.round(viewportXY[1] * viewport.height));
  return [x, y];
}

export class Executor {
  async executeAction(action: Action, browser: ExecutorBrowser): Promise<void> {
    if (action.actionType === 'click') {
      await this.executeClick(action, browser);
      return;
    }

    if (action.actionType === 'type') {
      await this.executeType(action, browser);
      return;
    }

    if (action.actionType === 'wait') {
      return;
    }

    throw new Error(`unsupported action type in Executor: ${action.actionType}`);
  }

  private async executeClick(action: Action, browser: ExecutorBrowser): Promise<void> {
    if (action.selector) {
      try {
        await browser.clickSelector(action.selector, 3_000);
        return;
      } catch {
        // selector fallback path
      }
    }

    if (!action.viewportXY) {
      throw new Error('click action requires selector or viewport coordinates');
    }

    const viewport = await browser.getViewportSize();
    const [x, y] = toAbsolutePoint(action.viewportXY, viewport);
    await browser.mouseClick(x, y);
  }

  private async executeType(action: Action, browser: ExecutorBrowser): Promise<void> {
    const value = action.value ?? '';

    if (action.selector) {
      try {
        await browser.fillSelector(action.selector, value);
        return;
      } catch {
        // selector fallback path
      }
    }

    if (!action.viewportXY) {
      throw new Error('type action requires selector or viewport coordinates');
    }

    const viewport = await browser.getViewportSize();
    const [x, y] = toAbsolutePoint(action.viewportXY, viewport);
    await browser.mouseClick(x, y);
    await browser.typeText(value);
  }
}
