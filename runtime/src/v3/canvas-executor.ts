import type { LocalDetection } from './local-detector';

export interface CanvasRuntime {
  getViewportSize(): Promise<{ width: number; height: number }>;
  mouseClick(x: number, y: number): Promise<void>;
}

export interface CanvasLocalDetectorLike {
  detect(imageBuffer: Buffer, threshold?: number): Promise<LocalDetection[]>;
}

export interface CanvasVlmClient {
  generate(input: { prompt: string; imageBuffer: Buffer; mimeType: string }): Promise<string>;
}

export interface CanvasExecutorOptions {
  detector: CanvasLocalDetectorLike;
  vlm: CanvasVlmClient;
}

export interface CanvasExecutionResult {
  clickedXY: [number, number];
  usedDetector: boolean;
  usedVlmFallback: boolean;
}

function parseVlmCoordinate(raw: string): [number, number] | undefined {
  const jsonBlock = raw.match(/\{[\s\S]*\}/);
  if (jsonBlock?.[0]) {
    try {
      const parsed = JSON.parse(jsonBlock[0]) as { x?: unknown; y?: unknown };
      if (typeof parsed.x === 'number' && typeof parsed.y === 'number') {
        return [parsed.x, parsed.y];
      }
    } catch {
      // continue to regex fallback
    }
  }

  const matched = raw.match(/x\s*[:=]\s*([0-9.]+)\s*[, ]\s*y\s*[:=]\s*([0-9.]+)/i);
  if (!matched) {
    return undefined;
  }
  const x = Number(matched[1]);
  const y = Number(matched[2]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return undefined;
  }
  return [x, y];
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function detectionCenter(box: [number, number, number, number], viewport: { width: number; height: number }): [number, number] {
  const centerX = (box[0] + box[2]) / 2;
  const centerY = (box[1] + box[3]) / 2;
  return [clamp(centerX / viewport.width), clamp(centerY / viewport.height)];
}

export class CanvasExecutor {
  private readonly detector: CanvasLocalDetectorLike;
  private readonly vlm: CanvasVlmClient;

  constructor(options: CanvasExecutorOptions) {
    this.detector = options.detector;
    this.vlm = options.vlm;
  }

  async execute(
    runtime: CanvasRuntime,
    imageBuffer: Buffer,
    actionDescription: string,
    mimeType = 'image/png'
  ): Promise<CanvasExecutionResult> {
    const viewport = await runtime.getViewportSize();
    const detections = await this.detector.detect(imageBuffer, 0.35);

    if (detections.length > 0) {
      const best = detections.slice().sort((left, right) => right.confidence - left.confidence)[0]!;
      const [nx, ny] = detectionCenter(best.box, viewport);
      const x = Math.round(nx * viewport.width);
      const y = Math.round(ny * viewport.height);
      await runtime.mouseClick(x, y);
      return {
        clickedXY: [x, y],
        usedDetector: true,
        usedVlmFallback: false
      };
    }

    const response = await this.vlm.generate({
      prompt: `Canvas UI target selection. Return JSON {"x":0~1,"y":0~1}. task: ${actionDescription}`,
      imageBuffer,
      mimeType
    });
    const parsed = parseVlmCoordinate(response);
    if (!parsed) {
      throw new Error('canvas vlm fallback returned no coordinates');
    }

    const x = Math.round(clamp(parsed[0]) * viewport.width);
    const y = Math.round(clamp(parsed[1]) * viewport.height);
    await runtime.mouseClick(x, y);
    return {
      clickedXY: [x, y],
      usedDetector: false,
      usedVlmFallback: true
    };
  }
}
