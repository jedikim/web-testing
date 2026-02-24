import type { FailureCode } from '../types';
import { buildCandidateContext, type CandidateItem } from './context-reducer';
import { validateSelectorPatch, type SelectorPatch } from './patch-validator';
import { applySelectorPatch, type SelectorRecipe } from './recipe-version';
import { proposePatchFromSimilo } from './similo';

export interface SelectorRecoveryRunResult {
  status: 'pass' | 'fail';
  failureCode?: FailureCode;
  candidates?: CandidateItem[];
  proposedPatch?: SelectorPatch;
}

export interface ExecuteWithSelectorRecoveryInput {
  recipe: SelectorRecipe;
  run: (recipe: SelectorRecipe) => Promise<SelectorRecoveryRunResult>;
  maxRecoveryAttempts?: number;
  updatedAt?: string;
  similoEnabled?: boolean;
  similoThreshold?: number;
}

export interface SelectorRecoveryOutput {
  status: 'pass' | 'fail';
  recipe: SelectorRecipe;
  attempts: number;
  llmCalls: number;
  similoRecoveries: number;
}

export async function executeWithSelectorRecovery(
  input: ExecuteWithSelectorRecoveryInput
): Promise<SelectorRecoveryOutput> {
  const maxRecoveryAttempts = input.maxRecoveryAttempts ?? 1;
  const similoEnabled = input.similoEnabled ?? process.env.SIMILO_ENABLED !== '0';
  let recipe = input.recipe;
  let attempts = 0;
  let llmCalls = 0;
  let similoRecoveries = 0;

  let result = await input.run(recipe);
  attempts += 1;
  if (result.status === 'pass') {
    return { status: 'pass', recipe, attempts, llmCalls, similoRecoveries };
  }

  for (let recoveryCount = 0; recoveryCount < maxRecoveryAttempts; recoveryCount += 1) {
    if (result.failureCode !== 'SelectorNotFound') {
      return { status: 'fail', recipe, attempts, llmCalls, similoRecoveries };
    }

    let preferredSelectorKey: string | undefined;
    const firstPath = result.proposedPatch?.operations[0]?.path;
    if (firstPath?.startsWith('/selectors/')) {
      preferredSelectorKey = firstPath.replace('/selectors/', '');
    }

    if (similoEnabled && result.candidates?.length) {
      const similoPatch = proposePatchFromSimilo({
        recipe,
        candidates: result.candidates,
        preferredSelectorKey,
        threshold: input.similoThreshold
      });

      if (similoPatch) {
        const similoValidation = validateSelectorPatch(similoPatch);
        if (similoValidation.valid) {
          recipe = applySelectorPatch(
            recipe,
            similoPatch,
            input.updatedAt ?? new Date().toISOString()
          );
          similoRecoveries += 1;
          result = await input.run(recipe);
          attempts += 1;
          if (result.status === 'pass') {
            return { status: 'pass', recipe, attempts, llmCalls, similoRecoveries };
          }
          if (result.failureCode !== 'SelectorNotFound') {
            return { status: 'fail', recipe, attempts, llmCalls, similoRecoveries };
          }
        }
      }
    }

    if (!result.proposedPatch) {
      return { status: 'fail', recipe, attempts, llmCalls, similoRecoveries };
    }

    if (result.candidates?.length) {
      buildCandidateContext(result.candidates);
    }
    llmCalls += 1;

    const validation = validateSelectorPatch(result.proposedPatch);
    if (!validation.valid) {
      return { status: 'fail', recipe, attempts, llmCalls, similoRecoveries };
    }

    recipe = applySelectorPatch(
      recipe,
      result.proposedPatch,
      input.updatedAt ?? new Date().toISOString()
    );

    result = await input.run(recipe);
    attempts += 1;
    if (result.status === 'pass') {
      return { status: 'pass', recipe, attempts, llmCalls, similoRecoveries };
    }
  }

  return { status: 'fail', recipe, attempts, llmCalls, similoRecoveries };
}
