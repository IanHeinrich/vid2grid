import { vi } from "vitest";
import { blankChat } from "../../src/chat/chats";
import { createMemoryStore } from "../../src/chat/store";
import type { AppElements } from "../../src/dom";
import { DEFAULT_SETTINGS } from "../../src/settings";
import {
  clearPending,
  createAppState,
  pendingFor,
  pendingVideo,
  replaceChat,
  setCurrentChat,
  type AppState,
} from "../../src/state";
import type { Chat, ChatStore, ImageRef, VideoAttachment } from "../../src/types";
import {
  initVideoPanel,
  type VideoPanel,
  type VideoPanelDeps,
} from "../../src/ui/video/videoPanel";
import { fileKey, type RenderedSheet } from "../../src/video/render";
import type { ToolContext } from "../../src/video/tools";
import { mountPage } from "./page";

export const INFO = { durationSeconds: 60, width: 640, height: 360 };
export const MODEL = "vision-model";

export let els: AppElements;
export let state: AppState;
export let store: ChatStore;
export let spies: ReturnType<typeof makeSpies>;

export function attachmentFor(file: File): VideoAttachment {
  return { name: file.name, fileKey: fileKey(file), ...INFO };
}

function makeSpies() {
  return {
    status: { show: vi.fn(), clear: vi.fn() },
    onChatChanged: vi.fn(),
    onVideoChanged: vi.fn(),
    onOverview: vi.fn(),
    onOverviewProgress: vi.fn(),
    studyStatus: () => "",
    copyStatus: () => "",
    loadCopy: vi.fn((): Promise<File | undefined> => Promise.resolve(undefined)),
    onAttached: vi.fn(),
    onCommitted: vi.fn(),
    audioWanted: () => false,
    probe: vi.fn((file: File) => Promise.resolve({ attachment: attachmentFor(file), info: INFO })),
    renderOverview: vi.fn(freshOverview),
    renderSheets: vi.fn(() => Promise.resolve<RenderedSheet[]>([])),
    readFrameTimes: vi.fn<(file: File) => Promise<number[] | undefined>>(() =>
      Promise.resolve(undefined),
    ),
  };
}

// Goes through the context's renderer, as a cache miss does, so the overview counts as new.
async function freshOverview(toolCtx: ToolContext): Promise<ImageRef[]> {
  await toolCtx.render?.(toolCtx.file, toolCtx.info, {});
  return [];
}

export async function resetVideoPanel(): Promise<void> {
  els = mountPage();
  state = createAppState({ ...DEFAULT_SETTINGS, apiKey: "key" });
  store = createMemoryStore();
  spies = makeSpies();
  const chat = blankChat(MODEL, "chat", 1);
  await store.putChat(chat);
  replaceChat(state, chat);
  setCurrentChat(state, chat, []);
  URL.createObjectURL = vi.fn(() => "blob:video");
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(() => Promise.resolve());
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
}

export function cleanUpVideoPanel(): void {
  vi.restoreAllMocks();
  delete window.showOpenFilePicker;
}

// What the composer does on send: the video becomes the chat's, then the pending items clear.
export async function send(videos: VideoPanel, chatId = "chat"): Promise<void> {
  const video = pendingVideo(pendingFor(state, chatId));
  if (!video) throw new Error("Nothing pending");
  await videos.commit(chatId, video);
  clearPending(state, chatId);
  videos.render();
}

export async function attachAndSend(
  videos: VideoPanel,
  file: File,
  handle?: FileSystemFileHandle,
): Promise<void> {
  await videos.attach(file, handle);
  await send(videos);
}

export async function openOther(videos: VideoPanel, id: string, modelId: string): Promise<void> {
  const other = blankChat(modelId, id, 2);
  await store.putChat(other);
  replaceChat(state, other);
  setCurrentChat(state, other, []);
  await videos.restore();
}

export function panel(overrides: Partial<VideoPanelDeps> = {}): VideoPanel {
  return initVideoPanel(els, state, { store, ...spies, ...overrides });
}

export function video(name: string, size = 3): File {
  return new File(["x".repeat(size)], name, { type: "video/mp4", lastModified: 5 });
}

export const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

export function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

export async function openChatWithVideo(attachment: VideoAttachment): Promise<Chat> {
  const chat = { ...blankChat(MODEL, "chat", 1), video: attachment };
  await store.putChat(chat);
  replaceChat(state, chat);
  setCurrentChat(state, chat, []);
  return chat;
}
