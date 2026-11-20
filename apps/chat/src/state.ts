import type { VideoInfo } from "@vid2grid/core";
import { isVenice } from "./api/client";
import type { GlobalSettings } from "./settings";
import { formatTimestamp } from "./time";
import type { Chat, ChatMessage, ChatStore, ImageRef, ModelInfo, VideoAttachment } from "./types";

export const NEW_CHAT_TITLE = "New chat";
export const DEFAULT_SHEET_RESOLUTION = "auto";
const TITLE_LENGTH = 40;

export type PendingAttachment =
  | { kind: "image"; ref: ImageRef }
  | { kind: "overview"; refs: ImageRef[] }
  | { kind: "video"; video: VideoAttachment };

export type OverviewStatus =
  | { kind: "rendering"; fileKey: string; done: number; total: number }
  | { kind: "ready"; fileKey: string; sheets: number }
  | { kind: "failed"; fileKey: string; error: string };

export interface LoadedVideo {
  chatId: string;
  file: File;
  info: VideoInfo;
}

// Readonly to every other module, so the setters below are the only writers.
export interface AppState {
  readonly settings: GlobalSettings;
  readonly models: readonly ModelInfo[];
  readonly modelsError: string | null;
  readonly chats: readonly Chat[];
  readonly currentChat: Chat | null;
  readonly messages: readonly ChatMessage[];
  readonly pending: ReadonlyMap<string, readonly PendingAttachment[]>;
  readonly overviews: ReadonlyMap<string, OverviewStatus>;
  readonly video: LoadedVideo | null;
  readonly running: boolean;
}

type WritableAppState = { -readonly [K in keyof AppState]: AppState[K] };

export function createAppState(settings: GlobalSettings): AppState {
  return {
    settings,
    models: [],
    modelsError: null,
    chats: [],
    currentChat: null,
    messages: [],
    pending: new Map(),
    overviews: new Map(),
    video: null,
    running: false,
  };
}

function newestFirst(chats: readonly Chat[]): Chat[] {
  return [...chats].sort((a, b) => b.updatedAt - a.updatedAt);
}

export function setSettings(state: WritableAppState, settings: GlobalSettings): void {
  state.settings = settings;
}

export function setModels(state: WritableAppState, models: readonly ModelInfo[]): void {
  state.models = models;
  state.modelsError = null;
}

export function setModelsError(state: WritableAppState, message: string): void {
  state.modelsError = message;
}

export function setChats(state: WritableAppState, chats: readonly Chat[]): void {
  state.chats = newestFirst(chats);
}

export function replaceChat(state: WritableAppState, chat: Chat): void {
  state.chats = newestFirst([...state.chats.filter((entry) => entry.id !== chat.id), chat]);
  if (state.currentChat?.id === chat.id) state.currentChat = chat;
}

// Applied to the newest copy and shown before the save, so overlapping writers each keep the other's change.
export async function updateChat(
  state: WritableAppState,
  store: Pick<ChatStore, "putChat">,
  chatId: string,
  change: (chat: Chat) => Chat,
): Promise<Chat | undefined> {
  const latest = state.chats.find((chat) => chat.id === chatId);
  if (!latest) return undefined;
  const updated = change(latest);
  replaceChat(state, updated);
  await store.putChat(updated);
  return updated;
}

export function removeChat(state: WritableAppState, id: string): void {
  state.chats = state.chats.filter((chat) => chat.id !== id);
  clearPending(state, id);
  setOverviewStatus(state, id, null);
  if (state.currentChat?.id === id) setCurrentChat(state, null, []);
}

export function setCurrentChat(
  state: WritableAppState,
  chat: Chat | null,
  messages: readonly ChatMessage[],
): void {
  state.currentChat = chat;
  state.messages = messages;
  state.video = null;
}

export function upsertMessage(state: WritableAppState, message: ChatMessage): void {
  const index = state.messages.findIndex((entry) => entry.id === message.id);
  state.messages =
    index === -1
      ? [...state.messages, message]
      : state.messages.map((entry, i) => (i === index ? message : entry));
}

export function pendingFor(state: AppState, chatId: string): readonly PendingAttachment[] {
  return state.pending.get(chatId) ?? [];
}

export function currentPending(state: AppState): readonly PendingAttachment[] {
  return state.currentChat ? pendingFor(state, state.currentChat.id) : [];
}

function setPendingFor(
  state: WritableAppState,
  chatId: string,
  attachments: readonly PendingAttachment[],
): void {
  const pending = new Map(state.pending);
  if (attachments.length === 0) pending.delete(chatId);
  else pending.set(chatId, attachments);
  state.pending = pending;
}

export function removeMessages(state: WritableAppState, ids: readonly string[]): void {
  const removed = new Set(ids);
  state.messages = state.messages.filter((message) => !removed.has(message.id));
}

export function restoreMessages(state: WritableAppState, restored: readonly ChatMessage[]): void {
  const ids = new Set(restored.map((message) => message.id));
  state.messages = [...state.messages.filter((message) => !ids.has(message.id)), ...restored].sort(
    (a, b) => a.createdAt - b.createdAt,
  );
}

export function addPending(
  state: WritableAppState,
  chatId: string,
  attachment: PendingAttachment,
): void {
  setPendingFor(state, chatId, [...pendingFor(state, chatId), attachment]);
}

export function removePending(state: WritableAppState, chatId: string, index: number): void {
  setPendingFor(
    state,
    chatId,
    pendingFor(state, chatId).filter((_, i) => i !== index),
  );
}

export function setPendingPinned(
  state: WritableAppState,
  chatId: string,
  index: number,
  pinned: boolean,
): void {
  const attachments = pendingFor(state, chatId).map((attachment, i) =>
    i === index && attachment.kind === "image"
      ? { kind: "image" as const, ref: { ...attachment.ref, pinned } }
      : attachment,
  );
  setPendingFor(state, chatId, attachments);
}

export function clearPending(state: WritableAppState, chatId: string): void {
  setPendingFor(state, chatId, []);
}

export function setPendingVideo(
  state: WritableAppState,
  chatId: string,
  video: VideoAttachment,
): void {
  const others = pendingFor(state, chatId).filter((attachment) => attachment.kind !== "video");
  setPendingFor(state, chatId, [{ kind: "video", video }, ...others]);
}

export function pendingVideo(pending: readonly PendingAttachment[]): VideoAttachment | undefined {
  for (const attachment of pending) if (attachment.kind === "video") return attachment.video;
  return undefined;
}

export function setOverviewStatus(
  state: WritableAppState,
  chatId: string,
  status: OverviewStatus | null,
): void {
  const overviews = new Map(state.overviews);
  if (status === null) overviews.delete(chatId);
  else overviews.set(chatId, status);
  state.overviews = overviews;
}

export function overviewFor(state: AppState, chatId: string): OverviewStatus | undefined {
  const status = state.overviews.get(chatId);
  const video = state.chats.find((chat) => chat.id === chatId)?.video;
  return status && status.fileKey === video?.fileKey ? status : undefined;
}

// A finished overview needs no label; only progress and failure are worth showing.
export function overviewText(status: OverviewStatus | undefined): string {
  switch (status?.kind) {
    case undefined:
    case "ready":
      return "";
    case "rendering":
      return status.total > 0
        ? `Overview ${Math.round((status.done / status.total) * 100)}%`
        : "Rendering overview";
    case "failed":
      return "Overview failed";
  }
}

export function videoSummary(video: VideoAttachment): string {
  return `${video.name} · ${formatTimestamp(video.durationSeconds)}`;
}

export function setLoadedVideo(state: WritableAppState, video: LoadedVideo | null): void {
  state.video = video;
}

export function setRunning(state: WritableAppState, running: boolean): void {
  state.running = running;
}

export function pendingImages(pending: readonly PendingAttachment[]): ImageRef[] {
  return pending.flatMap((attachment) => {
    switch (attachment.kind) {
      case "image":
        return [attachment.ref];
      case "overview":
        return attachment.refs;
      case "video":
        return [];
    }
  });
}

export function visionModels(models: readonly ModelInfo[], privateOnly: boolean): ModelInfo[] {
  return models.filter((model) => model.vision && (!privateOnly || model.privacy === "private"));
}

export function effectiveDefaultModelId(
  models: readonly ModelInfo[],
  privateOnly: boolean,
  defaultModelId: string,
): string {
  const visible = visionModels(models, privateOnly);
  const first = visible[0];
  if (first === undefined || visible.some((model) => model.id === defaultModelId)) {
    return defaultModelId;
  }
  return first.id;
}

export function defaultModelId(state: AppState): string {
  const { privateOnly, defaultModelId: stored } = state.settings;
  return effectiveDefaultModelId(state.models, privateOnly, stored);
}

export function resolveModel(state: AppState, modelId: string): ModelInfo {
  return (
    state.models.find((model) => model.id === modelId) ?? {
      id: modelId,
      name: modelId,
      vision: true,
      tools: true,
      reasoning: false,
      reasoningEffortOptions: [],
      maxImages: state.settings.fallbackMaxImages,
      privacy: "unknown",
      traits: [],
      uncensored: false,
      recommended: false,
      beta: false,
      videoInput: false,
      audioInput: false,
      e2ee: false,
    }
  );
}

export function currentModel(state: AppState): ModelInfo | null {
  const modelId = state.currentChat?.settings.modelId ?? "";
  return modelId === "" ? null : resolveModel(state, modelId);
}

export function sendBlocker(state: AppState): string | null {
  if (state.currentChat === null) return "Start a new chat from the sidebar.";
  if (isVenice(state.settings.baseUrl) && state.settings.apiKey.trim() === "") {
    return "Add your Venice API key in Settings to start chatting.";
  }
  if (currentModel(state) === null) return "Choose a model in Chat settings.";
  return null;
}

export function blankChat(modelId: string, id: string, now: number): Chat {
  return {
    id,
    title: NEW_CHAT_TITLE,
    createdAt: now,
    updatedAt: now,
    settings: {
      systemPrompt: "",
      modelId,
      sheetResolution: DEFAULT_SHEET_RESOLUTION,
    },
    sceneLog: [],
  };
}

export function titleFromMessage(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= TITLE_LENGTH ? flat : `${flat.slice(0, TITLE_LENGTH).trimEnd()}…`;
}
