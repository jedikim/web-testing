import { listSupportedModelIds } from '../llm/model-registry';

import type { EvolutionModelPolicy } from './types';

export interface ResolveEvolutionModelPolicyInput {
  source?: Record<string, string | undefined>;
}

const DEFAULT_CODING_MODEL = 'gemini-3.1-pro-preview';
const DEFAULT_AUTOMATION_MODEL = 'gemini-3-flash-preview';

function optionalTrim(raw: string | undefined): string | undefined {
  if (!raw) {
    return undefined;
  }
  const value = raw.trim();
  return value.length > 0 ? value : undefined;
}

function isGeminiModel(model: string): boolean {
  return model.toLowerCase().startsWith('gemini-');
}

function isFlashModel(model: string): boolean {
  return model.toLowerCase().includes('flash');
}

function supportedGeminiModels(): Set<string> {
  return new Set(['gemini-3.1-pro-preview', ...listSupportedModelIds('gemini')]);
}

function assertCodingModel(model: string): void {
  if (isFlashModel(model)) {
    throw new Error(
      `coding model must be a high-quality coding model (gemini pro preview), received: ${model}`
    );
  }

  if (isGeminiModel(model) && !supportedGeminiModels().has(model)) {
    throw new Error(`unsupported gemini coding model: ${model}`);
  }
}

function assertAutomationModel(model: string): void {
  if (!isFlashModel(model)) {
    throw new Error(
      `automation model must use a fast flash-tier model, received: ${model}`
    );
  }

  if (isGeminiModel(model) && !supportedGeminiModels().has(model)) {
    throw new Error(`unsupported gemini automation model: ${model}`);
  }
}

export function resolveEvolutionModelPolicy(
  input: ResolveEvolutionModelPolicyInput = {}
): EvolutionModelPolicy {
  const source = input.source ?? process.env;
  const codingModel = optionalTrim(source.EVOLUTION_CODING_MODEL) ?? DEFAULT_CODING_MODEL;
  const automationModel =
    optionalTrim(source.EVOLUTION_AUTOMATION_MODEL) ?? DEFAULT_AUTOMATION_MODEL;

  assertCodingModel(codingModel);
  assertAutomationModel(automationModel);

  return {
    codingModel,
    automationModel
  };
}
