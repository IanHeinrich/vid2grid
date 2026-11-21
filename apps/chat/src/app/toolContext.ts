import type { VideoInfo } from "@vid2grid/core";
import { currentModel, resolveModel } from "../chat/models";
import type { AppState } from "../state";
import type { Chat, ChatStore, ModelInfo, VideoAttachment } from "../types";
import { resolveOverviewResolution, resolveSheetResolution } from "../video/resolution";
import type { ToolContext } from "../video/tools";

export interface SheetSource {
  file: File;
  info: VideoInfo;
  video: VideoAttachment;
}

export function toolContext(state: AppState, store: ChatStore): ToolContext | undefined {
  const chat = state.currentChat;
  const model = currentModel(state);
  if (!chat?.video || state.video?.chatId !== chat.id || model === null) return undefined;
  return sheetContext(chat, model, { ...state.video, video: chat.video }, store);
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

export function chatModel(state: AppState, chat: Chat): ModelInfo | null {
  return chat.settings.modelId === "" ? null : resolveModel(state, chat.settings.modelId);
}
