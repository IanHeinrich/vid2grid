import type { VideoInfo } from "@vid2grid/core";
import type { GlobalSettings } from "./settings";
import type { ImageHolder } from "./imageIds";
import type { Chat, ChatMessage, ChatStore, ImageRef, ModelInfo, VideoAttachment } from "./types";

export type PendingAttachment =
  | { kind: "image"; ref: ImageRef }
  | { kind: "overview"; refs: ImageRef[] }
  | { kind: "video"; video: VideoAttachment };

export type OverviewStatus =
  | { kind: "needsModel"; fileKey: string }
  | { kind: "rendering"; fileKey: string; done: number; total: number }
  // Reused: the sheets came from the cache, so this video was seen before.
  | { kind: "ready"; fileKey: string; sheets: number; reused?: true }
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
  // The current chat's reply; runningChats holds every chat with one still running or stopping.
  readonly running: boolean;
  readonly runningChats: ReadonlySet<string>;
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
    runningChats: new Set(),
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
  removeDraft(state, id);
  unlistChat(state, id);
}

export function removeDraft(state: WritableAppState, chatId: string): void {
  clearPending(state, chatId);
  setOverviewStatus(state, chatId, null);
}

// Keeps the message being written, for a chat whose delete may yet fail.
export function unlistChat(state: WritableAppState, id: string): void {
  state.chats = state.chats.filter((chat) => chat.id !== id);
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
  state.running = chat !== null && state.runningChats.has(chat.id);
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

// Returns what was dropped, as removePendingVideo does, so its images can be let go.
export function removePending(
  state: WritableAppState,
  chatId: string,
  index: number,
): readonly PendingAttachment[] {
  return dropPending(state, chatId, (_, i) => i === index);
}

function dropPending(
  state: WritableAppState,
  chatId: string,
  drops: (attachment: PendingAttachment, index: number) => boolean,
): readonly PendingAttachment[] {
  const pending = pendingFor(state, chatId);
  setPendingFor(
    state,
    chatId,
    pending.filter((attachment, index) => !drops(attachment, index)),
  );
  return pending.filter(drops);
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

// The overview belongs to the pending video, so it goes with it.
export function removePendingVideo(
  state: WritableAppState,
  chatId: string,
): readonly PendingAttachment[] {
  return dropPending(state, chatId, ({ kind }) => kind === "video" || kind === "overview");
}

// A video dropped into the message being written shows in place of the chat's own until sent.
export function shownVideo(state: AppState, chatId: string): VideoAttachment | undefined {
  return (
    pendingVideo(pendingFor(state, chatId)) ?? state.chats.find((chat) => chat.id === chatId)?.video
  );
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
  return status && status.fileKey === shownVideo(state, chatId)?.fileKey ? status : undefined;
}

export function setLoadedVideo(state: WritableAppState, video: LoadedVideo | null): void {
  state.video = video;
}

export function setRunning(
  state: WritableAppState,
  running: boolean,
  chatId = state.currentChat?.id,
): void {
  if (chatId === undefined) return;
  const chats = new Set(state.runningChats);
  if (running) chats.add(chatId);
  else chats.delete(chatId);
  state.runningChats = chats;
  state.running = state.currentChat !== null && chats.has(state.currentChat.id);
}

export function isRunningIn(state: AppState, chatId: string): boolean {
  return state.runningChats.has(chatId);
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

export function pendingHolder(pending: readonly PendingAttachment[]): ImageHolder {
  const video = pendingVideo(pending);
  return { refs: pendingImages(pending), videoKeys: video ? [video.fileKey] : [] };
}
