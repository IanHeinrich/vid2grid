import { modelVisionProfile } from "@vid2grid/core";
import { currentModel } from "../chat/models";
import { buildRequest } from "../chat/request";
import { keptImages } from "../chat/story";
import { estimateRequestTokens, sheetSidesByUrl } from "../chat/tokenEstimate";
import { currentPending, pendingImages, type AppState } from "../state";
import type {
  AudioCoverage,
  Chat,
  ChatMessage,
  ModelInfo,
  Thoroughness,
  UserMessage,
  VideoCast,
  VideoTimeline,
} from "../types";
import { resolveSheetResolution } from "../video/resolution";
import { TOOL_GUIDANCE, toolSchemas } from "../video/tools";

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
