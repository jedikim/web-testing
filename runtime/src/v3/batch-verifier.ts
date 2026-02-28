import { GridComposer, type GridCellMapping, type GridItemImage } from './grid-composer';
import { LocalDetector } from './local-detector';

export interface BatchVLMClient {
  generate(input: { prompt: string; imageBuffer: Buffer; mimeType: string }): Promise<string>;
}

export interface BatchVerifierOptions {
  composer?: GridComposer;
  detector?: LocalDetector;
  vlm: BatchVLMClient;
}

export interface BatchVerifyResult {
  results: boolean[];
  mapping: GridCellMapping[];
  vlmCalls: number;
  detectorItemCount?: number;
}

function buildPrompt(question: string, mapping: GridCellMapping[]): string {
  return [
    `이미지는 총 ${mapping.length}개 셀의 그리드입니다.`,
    '각 셀 번호별로 질문에 대해 Y 또는 N으로 답하세요.',
    '응답 형식: 1:Y, 2:N, 3:Y ...',
    `질문: ${question}`
  ].join('\n');
}

function parseYnResponse(raw: string, count: number): boolean[] {
  const out = new Array<boolean>(count).fill(false);
  const matches = raw.matchAll(/(\d+)\s*[:=]\s*([YN])/gi);
  for (const match of matches) {
    const index = Number(match[1]) - 1;
    if (!Number.isFinite(index) || index < 0 || index >= count) {
      continue;
    }
    out[index] = match[2]?.toUpperCase() === 'Y';
  }
  return out;
}

export class BatchVerifier {
  private readonly composer: GridComposer;
  private readonly detector?: LocalDetector;
  private readonly vlm: BatchVLMClient;

  constructor(options: BatchVerifierOptions) {
    this.composer = options.composer ?? new GridComposer();
    this.detector = options.detector;
    this.vlm = options.vlm;
  }

  async verifyItems(
    items: GridItemImage[],
    question: string,
    composeOptions?: { cols?: number; cellWidth?: number; cellHeight?: number }
  ): Promise<BatchVerifyResult> {
    const composed = await this.composer.compose(items, composeOptions);
    const prompt = buildPrompt(question, composed.mapping);

    let detectorItemCount: number | undefined;
    if (this.detector) {
      detectorItemCount = await this.detector.countLikelyItems(composed.imageBuffer);
    }

    const response = await this.vlm.generate({
      prompt,
      imageBuffer: composed.imageBuffer,
      mimeType: composed.mimeType
    });
    const results = parseYnResponse(response, composed.mapping.length);
    return {
      results,
      mapping: composed.mapping,
      vlmCalls: 1,
      detectorItemCount
    };
  }
}
