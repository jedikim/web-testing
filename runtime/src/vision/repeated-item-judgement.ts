import type { CompositeSheetManifest, MappedCompositeDetection } from './composite-sheet';
import {
  buildCompositeSheet,
  mapDetectionsToSourceItems,
  type BuildCompositeSheetInput,
  type CompositeDetection,
  type CompositeSourceImage
} from './composite-sheet';

export interface RepeatedItemYoloJudgementResult {
  detections: CompositeDetection[];
  accepted?: boolean;
  reason?: string;
}

export interface RepeatedItemVlmJudgementResult {
  accepted: boolean;
  reason?: string;
  selectedSourceIds?: string[];
}

export interface YoloAssessmentResult {
  accepted: boolean;
  reason?: string;
}

export interface ExecuteRepeatedItemJudgementInput {
  images: CompositeSourceImage[];
  outputImagePath: string;
  outputManifestPath?: string;
  columns?: number;
  cellWidth?: number;
  cellHeight?: number;
  runYolo: (input: {
    compositeImagePath: string;
    manifest: CompositeSheetManifest;
  }) => Promise<RepeatedItemYoloJudgementResult>;
  assessYolo?: (input: {
    compositeImagePath: string;
    manifest: CompositeSheetManifest;
    yolo: RepeatedItemYoloJudgementResult;
    mappedDetections: MappedCompositeDetection[];
  }) => Promise<YoloAssessmentResult>;
  runVlm?: (input: {
    compositeImagePath: string;
    manifest: CompositeSheetManifest;
    yolo: RepeatedItemYoloJudgementResult;
    mappedDetections: MappedCompositeDetection[];
  }) => Promise<RepeatedItemVlmJudgementResult>;
  yoloMinConfidence?: number;
}

export interface RepeatedItemJudgementResult {
  compositeImagePath: string;
  compositeManifestPath?: string;
  manifest: CompositeSheetManifest;
  yolo: RepeatedItemYoloJudgementResult;
  mappedDetections: MappedCompositeDetection[];
  yoloAccepted: boolean;
  yoloDecisionReason: string;
  usedVlmFallback: boolean;
  vlm?: RepeatedItemVlmJudgementResult;
  finalStatus: 'accepted' | 'rejected';
  finalReason: string;
}

function asBuildInput(input: ExecuteRepeatedItemJudgementInput): BuildCompositeSheetInput {
  return {
    images: input.images,
    outputImagePath: input.outputImagePath,
    outputManifestPath: input.outputManifestPath,
    columns: input.columns,
    cellWidth: input.cellWidth,
    cellHeight: input.cellHeight
  };
}

function confidence(value: number | undefined): number {
  if (value == null || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

function defaultYoloAssessment(input: {
  yolo: RepeatedItemYoloJudgementResult;
  yoloMinConfidence: number;
}): YoloAssessmentResult {
  if (typeof input.yolo.accepted === 'boolean') {
    return {
      accepted: input.yolo.accepted,
      reason: input.yolo.reason ?? (input.yolo.accepted ? 'yolo accepted by provider' : 'yolo rejected by provider')
    };
  }

  if (!input.yolo.detections.length) {
    return {
      accepted: false,
      reason: 'yolo returned no detections'
    };
  }

  const maxConfidence = Math.max(...input.yolo.detections.map((row) => confidence(row.confidence)));
  if (maxConfidence < input.yoloMinConfidence) {
    return {
      accepted: false,
      reason: `yolo max confidence ${maxConfidence.toFixed(2)} below threshold ${input.yoloMinConfidence.toFixed(2)}`
    };
  }

  return {
    accepted: true,
    reason: `yolo confidence ${maxConfidence.toFixed(2)} meets threshold`
  };
}

export async function executeRepeatedItemJudgement(
  input: ExecuteRepeatedItemJudgementInput
): Promise<RepeatedItemJudgementResult> {
  const built = await buildCompositeSheet(asBuildInput(input));

  const yolo = await input.runYolo({
    compositeImagePath: built.imagePath,
    manifest: built.manifest
  });

  const mappedDetections = mapDetectionsToSourceItems(yolo.detections, built.manifest);

  const assessment = input.assessYolo
    ? await input.assessYolo({
        compositeImagePath: built.imagePath,
        manifest: built.manifest,
        yolo,
        mappedDetections
      })
    : defaultYoloAssessment({
        yolo,
        yoloMinConfidence: input.yoloMinConfidence ?? 0.55
      });

  if (assessment.accepted) {
    return {
      compositeImagePath: built.imagePath,
      compositeManifestPath: built.manifestPath,
      manifest: built.manifest,
      yolo,
      mappedDetections,
      yoloAccepted: true,
      yoloDecisionReason: assessment.reason ?? 'yolo accepted',
      usedVlmFallback: false,
      finalStatus: 'accepted',
      finalReason: assessment.reason ?? 'yolo accepted'
    };
  }

  if (!input.runVlm) {
    return {
      compositeImagePath: built.imagePath,
      compositeManifestPath: built.manifestPath,
      manifest: built.manifest,
      yolo,
      mappedDetections,
      yoloAccepted: false,
      yoloDecisionReason: assessment.reason ?? 'yolo rejected',
      usedVlmFallback: false,
      finalStatus: 'rejected',
      finalReason: assessment.reason ?? 'yolo rejected and no vlm fallback'
    };
  }

  const vlm = await input.runVlm({
    compositeImagePath: built.imagePath,
    manifest: built.manifest,
    yolo,
    mappedDetections
  });

  return {
    compositeImagePath: built.imagePath,
    compositeManifestPath: built.manifestPath,
    manifest: built.manifest,
    yolo,
    mappedDetections,
    yoloAccepted: false,
    yoloDecisionReason: assessment.reason ?? 'yolo rejected',
    usedVlmFallback: true,
    vlm,
    finalStatus: vlm.accepted ? 'accepted' : 'rejected',
    finalReason: vlm.reason ?? (vlm.accepted ? 'vlm accepted' : 'vlm rejected')
  };
}
