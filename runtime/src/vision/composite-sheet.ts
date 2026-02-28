import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { Jimp } from 'jimp';

import type { BBox } from './roi-batcher';

export interface CompositeSourceImage {
  id: string;
  imagePath: string;
  metadata?: Record<string, unknown>;
}

export interface CompositeSheetTile {
  sourceId: string;
  sourcePath: string;
  row: number;
  column: number;
  tileBbox: BBox;
}

export interface CompositeSheetManifest {
  imagePath: string;
  columns: number;
  rows: number;
  cellWidth: number;
  cellHeight: number;
  width: number;
  height: number;
  tiles: CompositeSheetTile[];
}

export interface BuildCompositeSheetInput {
  images: CompositeSourceImage[];
  outputImagePath: string;
  outputManifestPath?: string;
  columns?: number;
  cellWidth?: number;
  cellHeight?: number;
  backgroundColor?: number;
}

export interface BuildCompositeSheetOutput {
  imagePath: string;
  manifestPath?: string;
  manifest: CompositeSheetManifest;
}

export interface CompositeDetection {
  bbox: BBox;
  label?: string;
  confidence?: number;
  metadata?: Record<string, unknown>;
}

export interface MappedCompositeDetection extends CompositeDetection {
  matched: boolean;
  sourceId?: string;
  sourcePath?: string;
  tileBbox?: BBox;
}

function defaultManifestPath(imagePath: string): string {
  return `${imagePath}.manifest.json`;
}

function clampColumns(value: number | undefined, imageCount: number): number {
  if (!value || !Number.isFinite(value)) {
    return Math.max(1, Math.min(4, imageCount));
  }
  return Math.max(1, Math.min(Math.floor(value), imageCount));
}

function containsPoint(bbox: BBox, x: number, y: number): boolean {
  return x >= bbox[0] && x <= bbox[2] && y >= bbox[1] && y <= bbox[3];
}

function intersectionArea(a: BBox, b: BBox): number {
  const left = Math.max(a[0], b[0]);
  const top = Math.max(a[1], b[1]);
  const right = Math.min(a[2], b[2]);
  const bottom = Math.min(a[3], b[3]);
  if (right <= left || bottom <= top) {
    return 0;
  }
  return (right - left) * (bottom - top);
}

function bestTileForDetection(
  detection: CompositeDetection,
  tiles: CompositeSheetTile[]
): CompositeSheetTile | undefined {
  const centerX = (detection.bbox[0] + detection.bbox[2]) / 2;
  const centerY = (detection.bbox[1] + detection.bbox[3]) / 2;

  const centerMatched = tiles.find((tile) => containsPoint(tile.tileBbox, centerX, centerY));
  if (centerMatched) {
    return centerMatched;
  }

  const scored = tiles
    .map((tile) => ({
      tile,
      area: intersectionArea(detection.bbox, tile.tileBbox)
    }))
    .filter((row) => row.area > 0)
    .sort((left, right) => right.area - left.area);

  return scored[0]?.tile;
}

export async function buildCompositeSheet(
  input: BuildCompositeSheetInput
): Promise<BuildCompositeSheetOutput> {
  if (input.images.length === 0) {
    throw new Error('images must contain at least one item');
  }

  const cellWidth = Math.max(32, Math.floor(input.cellWidth ?? 256));
  const cellHeight = Math.max(32, Math.floor(input.cellHeight ?? 256));
  const columns = clampColumns(input.columns, input.images.length);
  const rows = Math.ceil(input.images.length / columns);

  const width = columns * cellWidth;
  const height = rows * cellHeight;
  const outputImagePath = resolve(input.outputImagePath);
  const outputManifestPath = resolve(input.outputManifestPath ?? defaultManifestPath(outputImagePath));

  const canvas = new Jimp({
    width,
    height,
    color: input.backgroundColor ?? 0xffffffff
  });
  const tiles: CompositeSheetTile[] = [];

  for (let index = 0; index < input.images.length; index += 1) {
    const source = input.images[index]!;
    const row = Math.floor(index / columns);
    const column = index % columns;

    const x = column * cellWidth;
    const y = row * cellHeight;

    const tileImage = await Jimp.read(source.imagePath);
    tileImage.contain({ w: cellWidth, h: cellHeight });
    canvas.composite(tileImage, x, y);

    tiles.push({
      sourceId: source.id,
      sourcePath: source.imagePath,
      row,
      column,
      tileBbox: [x, y, x + cellWidth, y + cellHeight]
    });
  }

  await mkdir(dirname(outputImagePath), { recursive: true });
  await canvas.write(outputImagePath as `${string}.${string}`);

  const manifest: CompositeSheetManifest = {
    imagePath: outputImagePath,
    columns,
    rows,
    cellWidth,
    cellHeight,
    width,
    height,
    tiles
  };

  await mkdir(dirname(outputManifestPath), { recursive: true });
  await writeFile(outputManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf-8');

  return {
    imagePath: outputImagePath,
    manifestPath: outputManifestPath,
    manifest
  };
}

export function mapDetectionsToSourceItems(
  detections: CompositeDetection[],
  manifest: CompositeSheetManifest
): MappedCompositeDetection[] {
  return detections.map((detection) => {
    const tile = bestTileForDetection(detection, manifest.tiles);
    if (!tile) {
      return {
        ...detection,
        matched: false
      };
    }

    return {
      ...detection,
      matched: true,
      sourceId: tile.sourceId,
      sourcePath: tile.sourcePath,
      tileBbox: tile.tileBbox
    };
  });
}
