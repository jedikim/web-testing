export type BBox = [number, number, number, number];

export interface Roi {
  id: string;
  bbox: BBox;
}

export interface RoiBatchMember extends Roi {
  relativeBbox: BBox;
}

export interface RoiBatch {
  batchBbox: BBox;
  members: RoiBatchMember[];
}

function unionBbox(items: Roi[]): BBox {
  const xs1 = items.map((item) => item.bbox[0]);
  const ys1 = items.map((item) => item.bbox[1]);
  const xs2 = items.map((item) => item.bbox[2]);
  const ys2 = items.map((item) => item.bbox[3]);
  return [Math.min(...xs1), Math.min(...ys1), Math.max(...xs2), Math.max(...ys2)];
}

function toRelative(bbox: BBox, batchBbox: BBox): BBox {
  return [
    bbox[0] - batchBbox[0],
    bbox[1] - batchBbox[1],
    bbox[2] - batchBbox[0],
    bbox[3] - batchBbox[1]
  ];
}

export function batchRois(rois: Roi[], maxPerBatch = 4): RoiBatch[] {
  if (rois.length === 0) {
    return [];
  }

  const batches: RoiBatch[] = [];
  for (let i = 0; i < rois.length; i += Math.max(1, maxPerBatch)) {
    const chunk = rois.slice(i, i + Math.max(1, maxPerBatch));
    const batchBbox = unionBbox(chunk);
    batches.push({
      batchBbox,
      members: chunk.map((item) => ({
        ...item,
        relativeBbox: toRelative(item.bbox, batchBbox)
      }))
    });
  }
  return batches;
}
