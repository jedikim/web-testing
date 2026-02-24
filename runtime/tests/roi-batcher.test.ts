import { describe, expect, it } from 'vitest';

import { batchRois, type Roi } from '../src/vision/roi-batcher';

describe('batchRois', () => {
  it('groups rois by max batch size', () => {
    const rois: Roi[] = [
      { id: 'a', bbox: [0, 0, 10, 10] },
      { id: 'b', bbox: [10, 10, 20, 20] },
      { id: 'c', bbox: [20, 20, 30, 30] }
    ];

    const result = batchRois(rois, 2);
    expect(result).toHaveLength(2);
    expect(result[0].members.map((m) => m.id)).toEqual(['a', 'b']);
    expect(result[1].members.map((m) => m.id)).toEqual(['c']);
  });

  it('computes relative bbox mapping inside each batch', () => {
    const rois: Roi[] = [
      { id: 'a', bbox: [100, 200, 140, 240] },
      { id: 'b', bbox: [120, 220, 180, 260] }
    ];

    const [batch] = batchRois(rois, 2);
    expect(batch.batchBbox).toEqual([100, 200, 180, 260]);
    expect(batch.members[0].relativeBbox).toEqual([0, 0, 40, 40]);
    expect(batch.members[1].relativeBbox).toEqual([20, 20, 80, 60]);
  });
});
