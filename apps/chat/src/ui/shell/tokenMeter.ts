import { usageCostUsd } from "../../api/usage";
import { estimateNextRequest } from "../../app/requestEstimate";
import { currentModel } from "../../chat/models";
import { contextLevel, formatCost, formatTokens, usageTotals } from "../../chat/tokenEstimate";
import type { AppElements } from "../../dom";
import type { AppState } from "../../state";
import type { AudioCoverage, TokenUsage, VideoTimeline } from "../../types";

const ROOM_HINT = "Unpin images or pick a smaller sheet resolution to make room.";

export interface UsageMeter {
  render(): void;
}

export interface UsageMeterDeps {
  timeline(): VideoTimeline | undefined;
  toolsAvailable(): boolean;
  // When audio is on for the next message, cachedAudioCoverage for the loaded video; otherwise undefined.
  audioCoverage?(): AudioCoverage | undefined;
}

function usageBreakdown(label: string, usage: TokenUsage): string {
  const cached = usage.cachedTokens ? ` (${formatTokens(usage.cachedTokens)} cached)` : "";
  const reasoning = usage.reasoningTokens
    ? ` (${formatTokens(usage.reasoningTokens)} reasoning)`
    : "";
  return `${label}: ${formatTokens(usage.promptTokens)} input${cached}, ${formatTokens(usage.completionTokens)} output${reasoning}`;
}

export function initUsageMeter(
  els: Pick<AppElements, "header">,
  state: AppState,
  deps: UsageMeterDeps,
): UsageMeter {
  const { usageContext, usageTotals: totalsEl, usageLine } = els.header;
  const render = () => {
    const model = currentModel(state);
    const estimate = estimateNextRequest(
      state,
      deps.timeline(),
      deps.toolsAvailable(),
      deps.audioCoverage?.(),
    );
    usageLine.hidden = estimate === undefined;
    if (estimate === undefined || !model) return;
    const window = model.contextTokens;
    const level = contextLevel(estimate, window);
    usageContext.textContent = `Context ≈ ${formatTokens(estimate)}${window ? ` / ${formatTokens(window)}` : ""}`;
    usageContext.className = `usage-context is-${level}`;
    const totals = usageTotals(state.messages);
    const cost = totals ? usageCostUsd(totals, model.pricing) : undefined;
    totalsEl.textContent = totals
      ? ` · ${formatTokens(totals.promptTokens)} in · ${formatTokens(totals.completionTokens)} out${cost === undefined ? "" : ` · ≈ ${formatCost(cost)}`}`
      : "";
    const studyUsage = deps.timeline()?.usage;
    usageLine.title = [
      `Next request ≈ ${estimate.toLocaleString("en-US")} tokens${window ? ` of a ${window.toLocaleString("en-US")} token context` : ""}`,
      totals ? usageBreakdown("This chat", totals) : "",
      studyUsage ? usageBreakdown("Studying this video", studyUsage) : "",
      level === "ok" ? "" : ROOM_HINT,
    ]
      .filter((line) => line !== "")
      .join("\n");
  };
  render();
  return { render };
}
