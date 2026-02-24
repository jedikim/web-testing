import type { FailureCode } from '../types';
import { validateSelectorPatch, type SelectorPatch } from '../fallback/patch-validator';
import { applySelectorPatch, type SelectorRecipe } from '../fallback/recipe-version';
import { batchRois, type Roi, type RoiBatch } from './roi-batcher';

export interface VisualRecoveryRunResult {
  status: 'pass' | 'fail';
  failureCode?: FailureCode;
  rois?: Roi[];
  patchesByRoiId?: Record<string, SelectorPatch>;
}

export interface ExecuteWithVisualRecoveryInput {
  recipe: SelectorRecipe;
  run: (recipe: SelectorRecipe) => Promise<VisualRecoveryRunResult>;
  selectRoi: (batches: RoiBatch[]) => Promise<string | undefined>;
  maxRecoveryAttempts?: number;
  maxRoiPerBatch?: number;
  updatedAt?: string;
}

export interface VisualRecoveryOutput {
  status: 'pass' | 'fail';
  recipe: SelectorRecipe;
  attempts: number;
  visionCalls: number;
}

export async function executeWithVisualRecovery(
  input: ExecuteWithVisualRecoveryInput
): Promise<VisualRecoveryOutput> {
  const maxRecoveryAttempts = input.maxRecoveryAttempts ?? 1;
  let recipe = input.recipe;
  let attempts = 0;
  let visionCalls = 0;

  let result = await input.run(recipe);
  attempts += 1;
  if (result.status === 'pass') {
    return { status: 'pass', recipe, attempts, visionCalls };
  }

  for (let recoveryCount = 0; recoveryCount < maxRecoveryAttempts; recoveryCount += 1) {
    if (result.failureCode !== 'VisualAmbiguity' || !result.rois?.length || !result.patchesByRoiId) {
      return { status: 'fail', recipe, attempts, visionCalls };
    }

    const batches = batchRois(result.rois, input.maxRoiPerBatch ?? 4);
    const roiId = await input.selectRoi(batches);
    visionCalls += 1;
    if (!roiId) {
      return { status: 'fail', recipe, attempts, visionCalls };
    }

    const patch = result.patchesByRoiId[roiId];
    if (!patch) {
      return { status: 'fail', recipe, attempts, visionCalls };
    }

    const validation = validateSelectorPatch(patch);
    if (!validation.valid) {
      return { status: 'fail', recipe, attempts, visionCalls };
    }

    recipe = applySelectorPatch(recipe, patch, input.updatedAt ?? new Date().toISOString());

    result = await input.run(recipe);
    attempts += 1;
    if (result.status === 'pass') {
      return { status: 'pass', recipe, attempts, visionCalls };
    }
  }

  return { status: 'fail', recipe, attempts, visionCalls };
}
