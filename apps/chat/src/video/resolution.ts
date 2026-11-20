import { modelVisionProfile } from "@vid2grid/core";
import type { ChatSettings, ModelInfo } from "../types";

const AUTO_STEPS = [2560, 2048, 1536, 1280, 1024, 768];
// Images stay in the history, so a full set of them may use at most this share of the context.
const IMAGE_CONTEXT_SHARE = 0.5;

export interface ResolvedResolution {
  px: number;
  reason: string;
}

export function resolveSheetResolution(
  setting: ChatSettings["sheetResolution"],
  model: ModelInfo,
): ResolvedResolution {
  if (setting !== "auto") return { px: setting, reason: `Fixed at ${setting} px` };
  const { family, autoResolution, imageTokens } = modelVisionProfile(model.id);
  const reason = `Auto for ${family}`;
  const { contextTokens } = model;
  if (imageTokens === undefined || contextTokens === undefined) {
    return { px: autoResolution, reason };
  }
  const candidates = [autoResolution, ...AUTO_STEPS.filter((px) => px < autoResolution)];
  const budget = contextTokens * IMAGE_CONTEXT_SHARE;
  const px =
    candidates.find((side) => imageTokens(side) * model.maxImages <= budget) ??
    candidates.at(-1) ??
    autoResolution;
  return px === autoResolution
    ? { px, reason }
    : { px, reason: `${reason}, reduced to fit the context` };
}

// The overview is resent on every turn, so it gets a budget of its own.
export const OVERVIEW_TOKEN_BUDGET = 20000;

export function resolveOverviewResolution(
  setting: ChatSettings["sheetResolution"],
  model: ModelInfo,
  sheets: number,
): ResolvedResolution {
  const full = resolveSheetResolution(setting, model);
  if (setting !== "auto") return full;
  const { imageTokens } = modelVisionProfile(model.id);
  if (imageTokens === undefined) return full;
  const fits = (side: number) => sheets * imageTokens(side) <= OVERVIEW_TOKEN_BUDGET;
  if (fits(full.px)) return full;
  const smaller = AUTO_STEPS.filter((px) => px < full.px);
  const px = smaller.find(fits) ?? smaller.at(-1) ?? full.px;
  const budget = `${OVERVIEW_TOKEN_BUDGET / 1000}k tokens`;
  return {
    px,
    reason: fits(px)
      ? `Overview at ${px} px to keep it under ${budget}`
      : `Overview at ${px} px, the smallest size, still over ${budget}`,
  };
}
