import type { ModelInfo, TokenUsage } from "../types";

const TOKENS_PER_PRICED_UNIT = 1_000_000;

export function addUsage(a?: TokenUsage, b?: TokenUsage): TokenUsage | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  const reasoningTokens = addOptional(a.reasoningTokens, b.reasoningTokens);
  const cachedTokens = addOptional(a.cachedTokens, b.cachedTokens);
  return {
    promptTokens: a.promptTokens + b.promptTokens,
    completionTokens: a.completionTokens + b.completionTokens,
    ...(reasoningTokens !== undefined && { reasoningTokens }),
    ...(cachedTokens !== undefined && { cachedTokens }),
  };
}

function addOptional(a?: number, b?: number): number | undefined {
  return a === undefined && b === undefined ? undefined : (a ?? 0) + (b ?? 0);
}

// Prompt tokens include the cached ones, and completion tokens include the reasoning ones.
// Without a cache-read rate, cached tokens cost the input rate.
export function usageCostUsd(
  usage: TokenUsage,
  pricing?: ModelInfo["pricing"],
): number | undefined {
  if (pricing === undefined) return undefined;
  const cached = Math.min(usage.cachedTokens ?? 0, usage.promptTokens);
  const cachedRate = pricing.cachedInputPerMTok ?? pricing.inputPerMTok;
  const total =
    (usage.promptTokens - cached) * pricing.inputPerMTok +
    cached * cachedRate +
    usage.completionTokens * pricing.outputPerMTok;
  return total / TOKENS_PER_PRICED_UNIT;
}
