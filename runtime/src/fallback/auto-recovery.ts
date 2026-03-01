import type { FailureCode } from '../types';
import {
  buildCandidateContext,
  buildCandidateContextWithSemanticRerank,
  type CandidateContext,
  type CandidateEmbeddingCache,
  type CandidateIntent,
  type CandidateItem
} from './context-reducer';
import { validateSelectorPatch, type SelectorPatch } from './patch-validator';
import { applySelectorPatch, type SelectorRecipe } from './recipe-version';
import { proposePatchFromSimilo } from './similo';
import type { VectorBackend } from './in-memory-vector-index';

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
  candidateContext?: {
    maxCandidates?: number;
    structureFirstLimit?: number;
    intent?: CandidateIntent;
    query?: string;
    semanticRerank?: {
      enabled?: boolean;
      query: string;
      pageKey?: string;
      vectorBackend?: VectorBackend;
      cache?: CandidateEmbeddingCache;
      embed: (texts: string[]) => Promise<number[][]>;
      topK?: number;
    };
    onBuilt?: (context: CandidateContext) => void | Promise<void>;
  };
}

export interface SelectorRecoveryOutput {
  status: 'pass' | 'fail';
  recipe: SelectorRecipe;
  attempts: number;
  llmCalls: number;
  similoRecoveries: number;
  reducedCandidateCount: number;
  semanticRerankCalls: number;
  embeddedCandidateCount: number;
  lastCandidateContext?: CandidateContext;
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
  let reducedCandidateCount = 0;
  let semanticRerankCalls = 0;
  let embeddedCandidateCount = 0;
  let lastCandidateContext: CandidateContext | undefined;

  let result = await input.run(recipe);
  attempts += 1;
  if (result.status === 'pass') {
    return {
      status: 'pass',
      recipe,
      attempts,
      llmCalls,
      similoRecoveries,
      reducedCandidateCount,
      semanticRerankCalls,
      embeddedCandidateCount,
      lastCandidateContext
    };
  }

  for (let recoveryCount = 0; recoveryCount < maxRecoveryAttempts; recoveryCount += 1) {
    if (result.failureCode !== 'SelectorNotFound') {
      return {
        status: 'fail',
        recipe,
        attempts,
        llmCalls,
        similoRecoveries,
        reducedCandidateCount,
        semanticRerankCalls,
        embeddedCandidateCount,
        lastCandidateContext
      };
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
            return {
              status: 'pass',
              recipe,
              attempts,
              llmCalls,
              similoRecoveries,
              reducedCandidateCount,
              semanticRerankCalls,
              embeddedCandidateCount,
              lastCandidateContext
            };
          }
          if (result.failureCode !== 'SelectorNotFound') {
            return {
              status: 'fail',
              recipe,
              attempts,
              llmCalls,
              similoRecoveries,
              reducedCandidateCount,
              semanticRerankCalls,
              embeddedCandidateCount,
              lastCandidateContext
            };
          }
        }
      }
    }

    if (!result.proposedPatch) {
      return {
        status: 'fail',
        recipe,
        attempts,
        llmCalls,
        similoRecoveries,
        reducedCandidateCount,
        semanticRerankCalls,
        embeddedCandidateCount,
        lastCandidateContext
      };
    }

    if (result.candidates?.length) {
      if (input.candidateContext?.semanticRerank?.enabled) {
        const context = await buildCandidateContextWithSemanticRerank(result.candidates, {
          maxCandidates: input.candidateContext.maxCandidates,
          structureFirstLimit: input.candidateContext.structureFirstLimit,
          intent: input.candidateContext.intent,
          query: input.candidateContext.query,
          semanticRerank: {
            ...input.candidateContext.semanticRerank,
            query: input.candidateContext.semanticRerank.query
          }
        });
        lastCandidateContext = context;
        semanticRerankCalls += 1;
        reducedCandidateCount += context.candidates.length;
        embeddedCandidateCount += context.metadata?.embeddedCandidateCount ?? 0;
        if (input.candidateContext.onBuilt) {
          await input.candidateContext.onBuilt(context);
        }
      } else {
        const context = buildCandidateContext(result.candidates, {
          maxCandidates: input.candidateContext?.maxCandidates,
          structureFirstLimit: input.candidateContext?.structureFirstLimit,
          intent: input.candidateContext?.intent,
          query: input.candidateContext?.query
        });
        lastCandidateContext = context;
        reducedCandidateCount += context.candidates.length;
        if (input.candidateContext?.onBuilt) {
          await input.candidateContext.onBuilt(context);
        }
      }
    }
    llmCalls += 1;

    const validation = validateSelectorPatch(result.proposedPatch);
    if (!validation.valid) {
      return {
        status: 'fail',
        recipe,
        attempts,
        llmCalls,
        similoRecoveries,
        reducedCandidateCount,
        semanticRerankCalls,
        embeddedCandidateCount,
        lastCandidateContext
      };
    }

    recipe = applySelectorPatch(
      recipe,
      result.proposedPatch,
      input.updatedAt ?? new Date().toISOString()
    );

    result = await input.run(recipe);
    attempts += 1;
    if (result.status === 'pass') {
      return {
        status: 'pass',
        recipe,
        attempts,
        llmCalls,
        similoRecoveries,
        reducedCandidateCount,
        semanticRerankCalls,
        embeddedCandidateCount,
        lastCandidateContext
      };
    }
  }

  return {
    status: 'fail',
    recipe,
    attempts,
    llmCalls,
    similoRecoveries,
    reducedCandidateCount,
    semanticRerankCalls,
    embeddedCandidateCount,
    lastCandidateContext
  };
}
