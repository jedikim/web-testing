import { Jimp, JimpMime } from 'jimp';
import { describe, expect, it } from 'vitest';

import { BatchVerifier } from '../src/v3/batch-verifier';
import { GridComposer } from '../src/v3/grid-composer';
import { LocalDetector } from '../src/v3/local-detector';

async function makeImage(color: string): Promise<Buffer> {
  const image = new Jimp({ width: 80, height: 80, color });
  return image.getBuffer(JimpMime.png);
}

describe('Week8 batch verification', () => {
  it('composes 20 items into a single grid and calls VLM once', async () => {
    const colors = ['#ffaaaa', '#aaffaa', '#aaaaff', '#ffffaa'];
    const items = await Promise.all(
      Array.from({ length: 20 }, async (_, index) => ({
        id: `item-${index + 1}`,
        imageBuffer: await makeImage(colors[index % colors.length]!),
        label: String(index + 1)
      }))
    );

    let vlmCalls = 0;
    const verifier = new BatchVerifier({
      composer: new GridComposer(),
      detector: new LocalDetector({
        backend: {
          async detect(): Promise<Array<{ box: [number, number, number, number]; confidence: number }>> {
            return Array.from({ length: 20 }, (_, index) => {
              const col = index % 4;
              const row = Math.floor(index / 4);
              const x = col * 300;
              const y = row * 300;
              return {
                box: [x, y, x + 300, y + 300],
                confidence: 0.9
              };
            });
          }
        }
      }),
      vlm: {
        async generate(): Promise<string> {
          vlmCalls += 1;
          return Array.from({ length: 20 }, (_, index) => `${index + 1}:${index % 2 === 0 ? 'Y' : 'N'}`).join(', ');
        }
      }
    });

    const result = await verifier.verifyItems(items, '붉은색 옷인지 판단');
    expect(vlmCalls).toBe(1);
    expect(result.vlmCalls).toBe(1);
    expect(result.mapping.length).toBe(20);
    expect(result.results.length).toBe(20);
    expect(result.results[0]).toBe(true);
    expect(result.results[1]).toBe(false);
    expect(result.detectorItemCount).toBe(20);
  });
});
