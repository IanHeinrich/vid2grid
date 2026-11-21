import { modelVisionProfile } from "@vid2grid/core";
import { addUsage, usageCostUsd } from "../api/usage";
import { buildRequest } from "../chat/request";
import { keptImages } from "../chat/story";
import { estimateRequestTokens, sheetSidesByUrl } from "../chat/tokenEstimate";
import type { AppElements } from "../dom";
import { currentModel, currentPending, pendingImages, type AppState } from "../state";
import type {
  AudioCoverage,
  Chat,
  ChatMessage,
  ModelInfo,
  Thoroughness,
  TokenUsage,
  UserMessage,
  VideoCast,
  VideoTimeline,
} from "../types";
import { resolveSheetResolution } from "../video/resolution";
import { TOOL_GUIDANCE, toolSchemas } from "../video/tools";

const WARN_SHARE = 0.7;
const DANGER_SHARE = 0.9;
const ROOM_HINT = "Unpin images or pick a smaller sheet resolution to make room.";

export type ContextLevel = "ok" | "warn" | "danger";

export interface UsageMeter {
  render(): void;
}

export interface UsageMeterDeps {
  timeline(): VideoTimeline | undefined;
  toolsAvailable(): boolean;
  // When audio is on for the next message, cachedAudioCoverage for the loaded video; otherwise undefined.
  audioCoverage?(): AudioCoverage | undefined;
}

function trimmed(value: number, digits: number): string {
  return value.toFixed(digits).replace(/\.0+$/, "");
}

export function formatTokens(count: number): string {
  if (count < 1000) return String(Math.round(count));
  if (count < 10_000) return `${trimmed(count / 1000, 1)}k`;
  if (count < 999_500) return `${Math.round(count / 1000)}k`;
  if (count < 10_000_000) return `${trimmed(count / 1_000_000, 1)}M`;
  return `${Math.round(count / 1_000_000)}M`;
}

export function formatCost(usd: number): string {
  return usd < 0.01 ? "< $0.01" : `$${usd.toFixed(2)}`;
}

export function usageTotals(messages: readonly ChatMessage[]): TokenUsage | undefined {
  return messages.reduce<TokenUsage | undefined>(
    (total, message) => (message.role === "assistant" ? addUsage(total, message.usage) : total),
    undefined,
  );
}

export function replyUsageText(messages: readonly ChatMessage[]): string {
  const usage = usageTotals(messages);
  return usage
    ? `${formatTokens(usage.promptTokens)} in / ${formatTokens(usage.completionTokens)} out`
    : "";
}

export function contextLevel(used: number, window: number | undefined): ContextLevel {
  if (window === undefined || window <= 0) return "ok";
  const share = used / window;
  return share > DANGER_SHARE ? "danger" : share > WARN_SHARE ? "warn" : "ok";
}

export interface TokenEstimateInput {
  chat: Chat;
  messages: readonly ChatMessage[];
  model: ModelInfo;
  allowTools: boolean;
  thoroughness?: Thoroughness;
  audioCoverage?: AudioCoverage | undefined;
  timeline?: VideoTimeline | undefined;
  cast?: VideoCast | undefined;
}

export function estimateTokens(input: TokenEstimateInput): number {
  const { chat, messages, model, thoroughness, audioCoverage, timeline, cast } = input;
  const kept = keptImages(chat, messages, model.maxImages);
  // Each image's id stands in for its pixels, so its recorded side can be found by URL.
  const dataUrls = new Map([...kept].map((id) => [id, id]));
  const request = buildRequest({
    chat,
    messages,
    model,
    kept,
    dataUrls,
    tools: toolSchemas(audioCoverage?.canListen === true),
    toolGuidance: TOOL_GUIDANCE,
    veniceParameters: false,
    allowTools: input.allowTools,
    finalRound: false,
    ...(thoroughness ? { thoroughness } : {}),
    ...(audioCoverage !== undefined ? { audioCoverage } : {}),
    ...(timeline ? { timeline } : {}),
    ...(cast ? { cast } : {}),
  });
  const resolution = resolveSheetResolution(chat.settings.sheetResolution, model).px;
  const { imageTokens } = modelVisionProfile(model.id);
  return estimateRequestTokens(
    request,
    resolution,
    imageTokens,
    sheetSidesByUrl(messages, dataUrls),
  );
}

// What the next request would hold: the history plus whatever is waiting in the composer.
export function estimateNextRequest(
  state: AppState,
  timeline: VideoTimeline | undefined,
  toolsAvailable: boolean,
  audioCoverage?: AudioCoverage,
): number | undefined {
  const chat = state.currentChat;
  const model = currentModel(state);
  if (!chat || !model) return undefined;
  const next: UserMessage = {
    id: "next",
    createdAt: Number.MAX_SAFE_INTEGER,
    role: "user",
    text: "",
    images: pendingImages(currentPending(state)),
  };
  const messages = [...state.messages, next];
  return estimateTokens({
    chat,
    messages,
    model,
    allowTools: toolsAvailable,
    timeline,
    ...(toolsAvailable && audioCoverage !== undefined ? { audioCoverage } : {}),
  });
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
