import { describe, expect, it } from 'vitest';

import { PlaywrightExecutorAdapter } from '../src/engine/playwright-executor';

class FakePage {
  public readonly calls: string[] = [];

  async click(selector: string): Promise<void> {
    this.calls.push(`click:${selector}`);
  }

  async dblclick(selector: string): Promise<void> {
    this.calls.push(`double_click:${selector}`);
  }

  async hover(selector: string): Promise<void> {
    this.calls.push(`hover:${selector}`);
  }

  async fill(selector: string, value: string): Promise<void> {
    this.calls.push(`type:${selector}:${value}`);
  }

  async press(selector: string, key: string): Promise<void> {
    this.calls.push(`key_press:${selector}:${key}`);
  }

  async waitForSelector(selector: string): Promise<void> {
    this.calls.push(`wait_for:${selector}`);
  }

  async selectOption(selector: string, value: string): Promise<void> {
    this.calls.push(`select_option:${selector}:${value}`);
  }

  async setInputFiles(selector: string, filePath: string): Promise<void> {
    this.calls.push(`upload_file:${selector}:${filePath}`);
  }

  readonly mouse = {
    click: async (x: number, y: number, options?: { button?: 'right' | 'left' }) => {
      this.calls.push(`mouse_click:${x},${y}:${options?.button ?? 'left'}`);
    },
    move: async (x: number, y: number) => {
      this.calls.push(`mouse_move:${x},${y}`);
    },
    down: async () => {
      this.calls.push('mouse_down');
    },
    up: async () => {
      this.calls.push('mouse_up');
    },
    wheel: async (dx: number, dy: number) => {
      this.calls.push(`wheel:${dx},${dy}`);
    }
  };
}

describe('PlaywrightExecutorAdapter', () => {
  it('executes required action set', async () => {
    const page = new FakePage();
    const adapter = new PlaywrightExecutorAdapter(page as never);

    await adapter.executeAction({ op: 'click', target: '#btn' });
    await adapter.executeAction({ op: 'double_click', target: '#btn' });
    await adapter.executeAction({ op: 'right_click', args: { x: 10, y: 20 } });
    await adapter.executeAction({ op: 'drag', args: { from: [0, 0], to: [5, 5] } });
    await adapter.executeAction({ op: 'hover', target: '#btn' });
    await adapter.executeAction({ op: 'scroll', args: { dx: 0, dy: 100 } });
    await adapter.executeAction({ op: 'type', target: '#q', args: { value: 'bag' } });
    await adapter.executeAction({ op: 'key_press', target: '#q', args: { key: 'Enter' } });
    await adapter.executeAction({ op: 'wait_for', target: '#result' });
    await adapter.executeAction({ op: 'select_option', target: '#sort', args: { value: 'price' } });
    await adapter.executeAction({ op: 'upload_file', target: '#file', args: { path: '/tmp/a.txt' } });

    expect(page.calls).toContain('click:#btn');
    expect(page.calls).toContain('double_click:#btn');
    expect(page.calls).toContain('mouse_click:10,20:right');
    expect(page.calls).toContain('mouse_down');
    expect(page.calls).toContain('mouse_up');
    expect(page.calls).toContain('wheel:0,100');
    expect(page.calls).toContain('type:#q:bag');
    expect(page.calls).toContain('key_press:#q:Enter');
    expect(page.calls).toContain('wait_for:#result');
    expect(page.calls).toContain('select_option:#sort:price');
    expect(page.calls).toContain('upload_file:#file:/tmp/a.txt');
  });
});
