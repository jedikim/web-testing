import type { AdapterExecutionResult } from './types';

export interface ExecutorAction {
  op:
    | 'click'
    | 'double_click'
    | 'right_click'
    | 'drag'
    | 'hover'
    | 'scroll'
    | 'type'
    | 'key_press'
    | 'wait_for'
    | 'select_option'
    | 'upload_file';
  target?: string;
  args?: Record<string, unknown>;
}

interface MouseLike {
  click(x: number, y: number, options?: { button?: 'left' | 'right' }): Promise<void>;
  move(x: number, y: number): Promise<void>;
  down(): Promise<void>;
  up(): Promise<void>;
  wheel(dx: number, dy: number): Promise<void>;
}

interface PageLike {
  click(selector: string): Promise<void>;
  dblclick(selector: string): Promise<void>;
  hover(selector: string): Promise<void>;
  fill(selector: string, value: string): Promise<void>;
  press(selector: string, key: string): Promise<void>;
  waitForSelector(selector: string): Promise<void>;
  selectOption(selector: string, value: string): Promise<void>;
  setInputFiles(selector: string, filePath: string): Promise<void>;
  mouse: MouseLike;
}

function asFailure(message: string): AdapterExecutionResult {
  return {
    ok: false,
    failureCode: 'ActionNotApplied',
    message
  };
}

export class PlaywrightExecutorAdapter {
  constructor(private readonly page: PageLike) {}

  async executeAction(action: ExecutorAction): Promise<AdapterExecutionResult> {
    try {
      switch (action.op) {
        case 'click': {
          if (!action.target) return asFailure('click target is required');
          await this.page.click(action.target);
          return { ok: true };
        }
        case 'double_click': {
          if (!action.target) return asFailure('double_click target is required');
          await this.page.dblclick(action.target);
          return { ok: true };
        }
        case 'right_click': {
          const x = Number(action.args?.x);
          const y = Number(action.args?.y);
          if (!Number.isFinite(x) || !Number.isFinite(y)) {
            return asFailure('right_click requires args.x and args.y');
          }
          await this.page.mouse.click(x, y, { button: 'right' });
          return { ok: true };
        }
        case 'drag': {
          const from = action.args?.from as [number, number] | undefined;
          const to = action.args?.to as [number, number] | undefined;
          if (!from || !to) return asFailure('drag requires args.from and args.to');
          await this.page.mouse.move(from[0], from[1]);
          await this.page.mouse.down();
          await this.page.mouse.move(to[0], to[1]);
          await this.page.mouse.up();
          return { ok: true };
        }
        case 'hover': {
          if (!action.target) return asFailure('hover target is required');
          await this.page.hover(action.target);
          return { ok: true };
        }
        case 'scroll': {
          const dx = Number(action.args?.dx ?? 0);
          const dy = Number(action.args?.dy ?? 0);
          await this.page.mouse.wheel(dx, dy);
          return { ok: true };
        }
        case 'type': {
          if (!action.target) return asFailure('type target is required');
          const value = String(action.args?.value ?? '');
          await this.page.fill(action.target, value);
          return { ok: true };
        }
        case 'key_press': {
          if (!action.target) return asFailure('key_press target is required');
          const key = String(action.args?.key ?? '');
          if (!key) return asFailure('key_press args.key is required');
          await this.page.press(action.target, key);
          return { ok: true };
        }
        case 'wait_for': {
          if (!action.target) return asFailure('wait_for target is required');
          await this.page.waitForSelector(action.target);
          return { ok: true };
        }
        case 'select_option': {
          if (!action.target) return asFailure('select_option target is required');
          const value = String(action.args?.value ?? '');
          if (!value) return asFailure('select_option args.value is required');
          await this.page.selectOption(action.target, value);
          return { ok: true };
        }
        case 'upload_file': {
          if (!action.target) return asFailure('upload_file target is required');
          const path = String(action.args?.path ?? '');
          if (!path) return asFailure('upload_file args.path is required');
          await this.page.setInputFiles(action.target, path);
          return { ok: true };
        }
        default:
          return asFailure(`unsupported action: ${(action as { op: string }).op}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return asFailure(message);
    }
  }
}
