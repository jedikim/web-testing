import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import Jimp from 'jimp';
import { describe, expect, it } from 'vitest';

import { buildCompositeSheet, mapDetectionsToSourceItems } from '../src/vision/composite-sheet';

async function makeImage(path: string, color: number): Promise<void> {
  const image = await new Jimp(48, 48, color);
  await image.writeAsync(path);
}

describe('composite-sheet', () => {
  it('builds composite grid image and maps detections back to source items', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'composite-sheet-'));

    try {
      const image1 = resolve(root, 'a.png');
      const image2 = resolve(root, 'b.png');
      const image3 = resolve(root, 'c.png');

      await makeImage(image1, 0xff0000ff);
      await makeImage(image2, 0x00ff00ff);
      await makeImage(image3, 0x0000ffff);

      const compositePath = resolve(root, 'sheet.png');
      const built = await buildCompositeSheet({
        images: [
          { id: 'item-a', imagePath: image1 },
          { id: 'item-b', imagePath: image2 },
          { id: 'item-c', imagePath: image3 }
        ],
        outputImagePath: compositePath,
        columns: 2,
        cellWidth: 64,
        cellHeight: 64
      });

      expect(built.imagePath).toBe(compositePath);
      expect(built.manifest.columns).toBe(2);
      expect(built.manifest.rows).toBe(2);
      expect(built.manifest.width).toBe(128);
      expect(built.manifest.height).toBe(128);
      expect(built.manifest.tiles).toHaveLength(3);

      const mapped = mapDetectionsToSourceItems(
        [
          { bbox: [8, 8, 24, 24], confidence: 0.9, label: 'candidate' },
          { bbox: [72, 8, 92, 24], confidence: 0.8, label: 'candidate' },
          { bbox: [8, 72, 24, 92], confidence: 0.7, label: 'candidate' },
          { bbox: [220, 220, 240, 240], confidence: 0.6, label: 'outside' }
        ],
        built.manifest
      );

      expect(mapped[0]?.sourceId).toBe('item-a');
      expect(mapped[1]?.sourceId).toBe('item-b');
      expect(mapped[2]?.sourceId).toBe('item-c');
      expect(mapped[3]?.matched).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
