import type { VideoInfo } from "@vid2grid/core";
import { currentModel, resolveModel } from "../chat/models";
import type { AppState } from "../state";
import { imagesOf } from "../imageRefs";
import type { Chat, ChatMessage, ChatStore, ModelInfo, VideoAttachment } from "../types";
import { resolveOverviewResolution, resolveSheetResolution } from "../video/resolution";
import { toolOffer, type ToolContext, type ToolOffer } from "../video/tools";
import { pictureModel } from "./lookingConnection";

export interface SheetSource {
  file: File;
  info: VideoInfo;
  video: VideoAttachment;
}

export function toolContext(state: AppState, store: ChatStore): ToolContext | undefined {
  const chat = state.currentChat;
  const model = currentModel(state);
  if (!chat?.video || state.video?.chatId !== chat.id || model === null) return undefined;
  const seenBy = pictureModel(state, chat, model);
  return sheetContext(chat, seenBy, { ...state.video, video: chat.video }, store);
}

export function sheetContext(
  chat: Chat,
  model: ModelInfo,
  { file, info, video }: SheetSource,
  store: ChatStore,
): ToolContext {
  return {
    file,
    info,
    video,
    resolution: resolveSheetResolution(chat.settings.sheetResolution, model).px,
    overviewResolution: (sheets) =>
      resolveOverviewResolution(chat.settings.sheetResolution, model, sheets).px,
    maxImages: model.maxImages,
    store,
  };
}

export interface LoadedParts {
  videoLoaded: boolean;
  // Audio is on for the message and the video has some to hear.
  listen: boolean;
  looking?: boolean;
}

export function conversationTools(
  model: Pick<ModelInfo, "vision">,
  messages: readonly ChatMessage[],
  loaded: LoadedParts,
): ToolOffer {
  const images = messages.some((message) => imagesOf(message).length > 0);
  return toolOffer({ ...loaded, images, vision: model.vision });
}

export function chatModel(state: AppState, chat: Chat): ModelInfo | null {
  return chat.settings.modelId === "" ? null : resolveModel(state, chat.settings.modelId);
}
