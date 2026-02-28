export interface LocalDetection {
  box: [number, number, number, number];
  confidence: number;
  label?: string;
}

export interface LocalDetectorBackend {
  detect(imageBuffer: Buffer, threshold?: number): Promise<LocalDetection[]>;
}

export interface LocalDetectorOptions {
  backend: LocalDetectorBackend;
}

function area(box: [number, number, number, number]): number {
  const width = Math.max(0, box[2] - box[0]);
  const height = Math.max(0, box[3] - box[1]);
  return width * height;
}

export class LocalDetector {
  private readonly backend: LocalDetectorBackend;

  constructor(options: LocalDetectorOptions) {
    this.backend = options.backend;
  }

  async detect(imageBuffer: Buffer, threshold = 0.35): Promise<LocalDetection[]> {
    return this.backend.detect(imageBuffer, threshold);
  }

  async countLikelyItems(imageBuffer: Buffer, threshold = 0.35): Promise<number> {
    const detections = await this.detect(imageBuffer, threshold);
    if (detections.length === 0) {
      return 0;
    }

    const sortedAreas = detections.map((d) => area(d.box)).sort((a, b) => a - b);
    const median = sortedAreas[Math.floor(sortedAreas.length / 2)] ?? 0;
    if (median <= 0) {
      return detections.length;
    }

    return detections.filter((d) => {
      const value = area(d.box);
      return value >= median * 0.4 && value <= median * 2.5;
    }).length;
  }
}
