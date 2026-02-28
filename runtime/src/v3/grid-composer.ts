import Jimp from 'jimp';

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

    const canvas = await Jimp.create(width, height, '#ffffff');
    const font = await Jimp.loadFont(Jimp.FONT_SANS_16_BLACK);

    const mapping: GridCellMapping[] = [];
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index]!;
      const row = Math.floor(index / cols);
      const col = index % cols;
      const x = col * cellWidth;
      const y = row * cellHeight;

      const image = await Jimp.read(item.imageBuffer);
      image.cover(cellWidth, cellHeight);
      canvas.composite(image, x, y);

      const label = item.label?.trim().length ? item.label!.trim() : String(index + 1);
      canvas.print(font, x + 8, y + 8, `${label}`);
      mapping.push({
        index,
        id: item.id,
        label,
        row,
        col,
        bbox: [x, y, x + cellWidth, y + cellHeight]
      });
    }

    const imageBuffer = await canvas.getBufferAsync(Jimp.MIME_PNG);
    return {
      imageBuffer,
      mimeType: 'image/png',
      width,
      height,
      mapping
    };
  }
}
