import { Jimp, JimpMime, loadFont } from 'jimp';
import { SANS_16_BLACK } from 'jimp/fonts';

export interface GridItemImage {
  id: string;
  imageBuffer: Buffer;
  label?: string;
}

export interface GridComposeOptions {
  cols?: number;
  cellWidth?: number;
  cellHeight?: number;
}

export interface GridCellMapping {
  index: number;
  id: string;
  label: string;
  row: number;
  col: number;
  bbox: [number, number, number, number];
}

export interface GridComposeResult {
  imageBuffer: Buffer;
  mimeType: 'image/png';
  width: number;
  height: number;
  mapping: GridCellMapping[];
}

export class GridComposer {
  async compose(items: GridItemImage[], options: GridComposeOptions = {}): Promise<GridComposeResult> {
    if (items.length === 0) {
      throw new Error('grid compose requires at least one image');
    }

    const cols = Math.max(1, Math.floor(options.cols ?? 4));
    const cellWidth = Math.max(32, Math.floor(options.cellWidth ?? 300));
    const cellHeight = Math.max(32, Math.floor(options.cellHeight ?? 300));
    const rows = Math.ceil(items.length / cols);
    const width = cols * cellWidth;
    const height = rows * cellHeight;

    const canvas = new Jimp({ width, height, color: '#ffffff' });
    const font = await loadFont(SANS_16_BLACK);

    const mapping: GridCellMapping[] = [];
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index]!;
      const row = Math.floor(index / cols);
      const col = index % cols;
      const x = col * cellWidth;
      const y = row * cellHeight;

      const image = await Jimp.read(item.imageBuffer);
      image.cover({ w: cellWidth, h: cellHeight });
      canvas.composite(image, x, y);

      const label = item.label?.trim().length ? item.label!.trim() : String(index + 1);
      canvas.print({ font, x: x + 8, y: y + 8, text: `${label}` });
      mapping.push({
        index,
        id: item.id,
        label,
        row,
        col,
        bbox: [x, y, x + cellWidth, y + cellHeight]
      });
    }

    const imageBuffer = await canvas.getBuffer(JimpMime.png);
    return {
      imageBuffer,
      mimeType: 'image/png',
      width,
      height,
      mapping
    };
  }
}
