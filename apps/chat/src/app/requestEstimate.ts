import { modelVisionProfile } from "@vid2grid/core";
import { cachedAudio } from "../audio/videoAudio";
import { currentModel } from "../chat/models";
import { buildRequest } from "../chat/request";
import { lookingModelId } from "../chat/seen";
import { keptImages, visibleMessages } from "../chat/story";
import { estimateRequestTokens, sheetSidesByUrl } from "../chat/tokenEstimate";
import { transcriptToCarry, transcriptTokenCap, type HeardSpeech } from "../chat/transcript";
import { currentPending, pendingImages, shownVideo, type AppState } from "../state";
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
import { conversationTools } from "./toolContext";

export interface TokenEstimateInput {
  chat: Chat;
  messages: readonly ChatMessage[];
  model: ModelInfo;
  videoLoaded: boolean;
  thoroughness?: Thoroughness;
  audioCoverage?: AudioCoverage | undefined;
  speech?: HeardSpeech | undefined;
  timeline?: VideoTimeline | undefined;
  cast?: VideoCast | undefined;
}

export function estimateTokens(input: TokenEstimateInput): number {
  const { chat, messages, model, thoroughness, audioCoverage, speech, timeline, cast } = input;
  const { tools, guidance } = conversationTools(model, messages, {
    videoLoaded: input.videoLoaded,
    listen: audioCoverage?.canListen === true,
    looking: lookingModelId(chat) !== undefined,
  });
  const kept = keptImages(chat, messages, model.maxImages);
  // Each image's id stands in for its pixels, so its recorded side can be found by URL.
  const dataUrls = new Map([...kept].map((id) => [id, id]));
  const request = buildRequest({
    chat,
    messages,
    model,
    kept,
    dataUrls,
    tools,
    toolGuidance: guidance,
    veniceParameters: false,
    allowTools: tools.length > 0,
    finalRound: false,
    ...(thoroughness ? { thoroughness } : {}),
    ...(audioCoverage !== undefined ? { audioCoverage } : {}),
    ...(speech ? { speech } : {}),
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

function shownSpeech(state: AppState, chatId: string): HeardSpeech | undefined {
  const fileKey = shownVideo(state, chatId)?.fileKey;
  return fileKey === undefined ? undefined : cachedAudio(fileKey);
}

// What the next request would hold: the history plus whatever is waiting in the composer.
export function estimateNextRequest(
  state: AppState,
  timeline: VideoTimeline | undefined,
  videoLoaded: boolean,
  audioCoverage?: AudioCoverage,
): number | undefined {
  const chat = state.currentChat;
  const model = currentModel(state);
  if (!chat || !model) return undefined;
  const speech = audioCoverage === undefined ? undefined : shownSpeech(state, chat.id);
  const next: UserMessage = {
    id: "next",
    createdAt: Number.MAX_SAFE_INTEGER,
    role: "user",
    text: "",
    images: pendingImages(currentPending(state)),
  };
  const visible = visibleMessages(chat, [...state.messages, next]);
  const transcript = speech && transcriptToCarry(visible, speech, transcriptTokenCap(model));
  const messages = [...state.messages, { ...next, ...(transcript ? { transcript } : {}) }];
  return estimateTokens({
    chat,
    messages,
    model,
    videoLoaded,
    timeline,
    speech,
    ...(videoLoaded && audioCoverage !== undefined ? { audioCoverage } : {}),
  });
}
