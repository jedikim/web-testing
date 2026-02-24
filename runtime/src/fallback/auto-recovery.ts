import type { FailureCode } from '../types';
import { buildCandidateContext, type CandidateItem } from './context-reducer';
import { validateSelectorPatch, type SelectorPatch } from './patch-validator';
import { applySelectorPatch, type SelectorRecipe } from './recipe-version';

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
}

export interface SelectorRecoveryOutput {
  status: 'pass' | 'fail';
  recipe: SelectorRecipe;
  attempts: number;
  llmCalls: number;
}

export async function executeWithSelectorRecovery(
  input: ExecuteWithSelectorRecoveryInput
): Promise<SelectorRecoveryOutput> {
  const maxRecoveryAttempts = input.maxRecoveryAttempts ?? 1;
  let recipe = input.recipe;
  let attempts = 0;
  let llmCalls = 0;

  let result = await input.run(recipe);
  attempts += 1;
  if (result.status === 'pass') {
    return { status: 'pass', recipe, attempts, llmCalls };
  }

  for (let recoveryCount = 0; recoveryCount < maxRecoveryAttempts; recoveryCount += 1) {
    if (result.failureCode !== 'SelectorNotFound' || !result.proposedPatch) {
      return { status: 'fail', recipe, attempts, llmCalls };
    }

    if (result.candidates?.length) {
      buildCandidateContext(result.candidates);
    }
    llmCalls += 1;

    const validation = validateSelectorPatch(result.proposedPatch);
    if (!validation.valid) {
      return { status: 'fail', recipe, attempts, llmCalls };
    }

    recipe = applySelectorPatch(
      recipe,
      result.proposedPatch,
      input.updatedAt ?? new Date().toISOString()
    );

    result = await input.run(recipe);
    attempts += 1;
    if (result.status === 'pass') {
      return { status: 'pass', recipe, attempts, llmCalls };
    }
  }

  return { status: 'fail', recipe, attempts, llmCalls };
}
