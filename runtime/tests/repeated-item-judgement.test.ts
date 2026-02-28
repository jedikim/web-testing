import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { Jimp } from 'jimp';
import { describe, expect, it } from 'vitest';

import { executeRepeatedItemJudgement } from '../src/vision/repeated-item-judgement';

async function makeImage(path: string, color: number): Promise<void> {
  const image = new Jimp({ width: 64, height: 64, color });
  await image.write(path as `${string}.${string}`);
}

describe('executeRepeatedItemJudgement', () => {
  it('accepts with yolo when confidence is sufficient', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'repeat-judge-yolo-'));

    try {
      const image1 = resolve(root, 'a.png');
      const image2 = resolve(root, 'b.png');
      await makeImage(image1, 0xff0000ff);
      await makeImage(image2, 0x00ff00ff);

      let yoloInputPath = '';
      let vlmCalled = 0;

      const result = await executeRepeatedItemJudgement({
        images: [
          { id: 'item-a', imagePath: image1 },
          { id: 'item-b', imagePath: image2 }
        ],
        outputImagePath: resolve(root, 'sheet.png'),
        runYolo: async ({ compositeImagePath }) => {
          yoloInputPath = compositeImagePath;
          return {
            detections: [{ bbox: [10, 10, 30, 30], confidence: 0.92, label: 'item' }]
          };
        },
        runVlm: async () => {
          vlmCalled += 1;
          return {
            accepted: true,
            reason: 'vlm fallback'
          };
        }
      });

      expect(result.finalStatus).toBe('accepted');
      expect(result.usedVlmFallback).toBe(false);
      expect(vlmCalled).toBe(0);
      expect(result.compositeImagePath).toBe(yoloInputPath);
      expect(result.mappedDetections[0]?.sourceId).toBe('item-a');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('falls back to vlm with the same composite image when yolo is insufficient', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'repeat-judge-vlm-'));

    try {
      const image1 = resolve(root, 'a.png');
      const image2 = resolve(root, 'b.png');
      const image3 = resolve(root, 'c.png');
      await makeImage(image1, 0xff0000ff);
      await makeImage(image2, 0x00ff00ff);
      await makeImage(image3, 0x0000ffff);

      let yoloInputPath = '';
      let vlmInputPath = '';

      const result = await executeRepeatedItemJudgement({
        images: [
          { id: 'item-a', imagePath: image1 },
          { id: 'item-b', imagePath: image2 },
          { id: 'item-c', imagePath: image3 }
        ],
        outputImagePath: resolve(root, 'sheet.png'),
        columns: 2,
        cellWidth: 64,
        cellHeight: 64,
        yoloMinConfidence: 0.8,
        runYolo: async ({ compositeImagePath }) => {
          yoloInputPath = compositeImagePath;
          return {
            detections: [{ bbox: [70, 10, 94, 28], confidence: 0.31, label: 'candidate' }]
          };
        },
        runVlm: async ({ compositeImagePath }) => {
          vlmInputPath = compositeImagePath;
          return {
            accepted: true,
            reason: 'vlm confirms repeated listing'
          };
        }
      });

      expect(result.usedVlmFallback).toBe(true);
      expect(result.finalStatus).toBe('accepted');
      expect(yoloInputPath).toBe(vlmInputPath);
      expect(result.mappedDetections[0]?.sourceId).toBe('item-b');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
