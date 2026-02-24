import { validateSelectorPatch, type SelectorPatch } from './patch-validator';

export interface SelectorFingerprint {
  text?: string;
  role?: string;
  idHint?: string;
  classTokens?: string[];
  nearbyText?: string[];
  bboxNorm?: [number, number, number, number];
}

export interface SelectorRecipeEntry {
  css: string;
  updatedAt: string;
  fingerprint?: SelectorFingerprint;
}

export interface SelectorRecipe {
  workflowId: string;
  version: string;
  selectors: Record<string, SelectorRecipeEntry>;
}

export function nextRecipeVersion(version: string): string {
  if (!/^v\d+$/.test(version)) {
    throw new Error(`invalid version format: ${version}`);
  }
  const n = Number(version.slice(1)) + 1;
  return `v${String(n).padStart(3, '0')}`;
}

function selectorKeyFromPath(path: string): string {
  return path.replace('/selectors/', '');
}

export function applySelectorPatch(
  recipe: SelectorRecipe,
  patch: SelectorPatch,
  updatedAt: string
): SelectorRecipe {
  const validation = validateSelectorPatch(patch);
  if (!validation.valid) {
    const reason = validation.errors.map((e) => e.code).join(',');
    throw new Error(`invalid selector patch: ${reason}`);
  }

  const nextSelectors = { ...recipe.selectors };
  for (const operation of patch.operations) {
    const key = selectorKeyFromPath(operation.path);
    if (operation.op === 'remove') {
      delete nextSelectors[key];
      continue;
    }

    nextSelectors[key] = {
      css: operation.value!.css!,
      updatedAt,
      fingerprint: operation.value?.fingerprint
    };
  }

  return {
    workflowId: recipe.workflowId,
    version: nextRecipeVersion(recipe.version),
    selectors: nextSelectors
  };
}
