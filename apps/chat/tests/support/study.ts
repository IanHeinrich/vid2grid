import { expect, vi } from "vitest";
import { VENICE_BASE_URL } from "../../src/api/venice";
import type { AnalyseAudio } from "../../src/audio/videoAudio";
import { blankChat } from "../../src/chat/chats";
import { resolveModel } from "../../src/chat/models";
import { createMemoryStore } from "../../src/chat/store";
import type { AppElements } from "../../src/dom";
import { DEFAULT_SETTINGS } from "../../src/settings";
import {
  createAppState,
  replaceChat,
  setCurrentChat,
  setModels,
  type AppState,
} from "../../src/state";
import type {
  ChatStore,
  ModelInfo,
  UnclearSpan,
  VideoAttachment,
  VideoTimeline,
} from "../../src/types";
import type { ChatVideo } from "../../src/ui/video/knowledgeVideos";
import { initStudy, type Study } from "../../src/ui/study/studyPanel";
import { zoomOfferText } from "../../src/ui/study/studyProgress";
import { resolveSheetResolution } from "../../src/video/resolution";
import {
  planStudy,
  planZoom,
  runStudy,
  runZoom,
  type StudyDeps as RunDeps,
  type StudyPlanInput,
  type ZoomDeps,
} from "../../src/video/study";
import type { ToolContext } from "../../src/video/tools";
import { mountPage, stillToast } from "./page";

export const STUDY_MODEL_ID = "qwen3-6-27b";

export const VIDEO: VideoAttachment = {
  name: "beach.mp4",
  fileKey: "beach-key",
  durationSeconds: 600,
  width: 1280,
  height: 720,
};

export let els: AppElements;
export let state: AppState;
export let store: ChatStore;
export let confirm: ReturnType<typeof vi.fn>;
export let openPlayer: ReturnType<typeof vi.fn>;
export let seekVideo: ReturnType<typeof vi.fn>;
export let openTimeline: ReturnType<typeof vi.fn>;
export let removeBlocker: ReturnType<typeof vi.fn<() => string | undefined>>;
export let onRemoveVideo: ReturnType<typeof vi.fn>;
export let focusComposer: ReturnType<typeof vi.fn>;
export let status: { show: ReturnType<typeof vi.fn>; clear: ReturnType<typeof vi.fn> };
export let analyseAudio: ReturnType<typeof vi.fn<AnalyseAudio>>;

export function reloadPage(): void {
  els = mountPage();
}

export function resetStudy(): void {
  localStorage.clear();
  reloadPage();
  state = createAppState({
    ...DEFAULT_SETTINGS,
    baseUrl: VENICE_BASE_URL,
    apiKey: "key",
    defaultModelId: STUDY_MODEL_ID,
  });
  store = createMemoryStore();
  confirm = vi.fn(() => true);
  openPlayer = vi.fn();
  seekVideo = vi.fn();
  openTimeline = vi.fn();
  removeBlocker = vi.fn((): string | undefined => undefined);
  onRemoveVideo = vi.fn();
  focusComposer = vi.fn();
  status = { show: vi.fn(), clear: vi.fn() };
  analyseAudio = vi.fn<AnalyseAudio>((_file, request) =>
    Promise.resolve({
      speech: [],
      events: [],
      startSeconds: request.startSeconds ?? 0,
      durationSeconds: (request.endSeconds ?? 0) - (request.startSeconds ?? 0),
    }),
  );
  const chat = { ...blankChat(STUDY_MODEL_ID, "chat", 1), video: VIDEO };
  replaceChat(state, chat);
  setCurrentChat(state, chat, []);
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.open = true;
  };
  vi.mocked(runStudy).mockReset();
  vi.mocked(runZoom).mockReset();
}

export function setup(shownVideo?: () => ChatVideo | undefined): Study {
  const file = new File(["video"], VIDEO.name);
  const toolContext = { file, video: VIDEO, store } as unknown as ToolContext;
  return initStudy(els, state, {
    store,
    status,
    toast: stillToast(els),
    streamChat: vi.fn(),
    confirm,
    toolContext: () => toolContext,
    openPlayer,
    seekVideo,
    openTimeline,
    removeBlocker,
    onRemoveVideo,
    focusComposer,
    currentTime: () => 75.4,
    onChanged: vi.fn(),
    analyseAudio,
    now: () => 50,
    ...(shownVideo && { shownVideo }),
  });
}

export function expectedPlan() {
  const chat = state.currentChat;
  if (!chat) throw new Error("No chat");
  return planFor(chat.settings.modelId);
}

export function planFor(modelId: string, options: Partial<StudyPlanInput> = {}) {
  const chat = state.currentChat;
  if (!chat) throw new Error("No chat");
  const model = resolveModel(state, modelId);
  return planStudy({
    durationSeconds: VIDEO.durationSeconds,
    sourceAspect: VIDEO.width / VIDEO.height,
    resolution: resolveSheetResolution(chat.settings.sheetResolution, model).px,
    model,
    ...options,
  });
}

export function model(id: string): ModelInfo {
  return { ...resolveModel(state, id), privacy: "private", contextTokens: 262144 };
}

export function timeline(entries: VideoTimeline["entries"]): VideoTimeline {
  return {
    fileKey: VIDEO.fileKey,
    modelId: "m",
    entries,
    nextWindow: 3,
    windowCount: 3,
    updatedAt: 1,
  };
}

export async function seeded(): Promise<Study> {
  await store.putTimeline(
    timeline([
      { startSeconds: 0, endSeconds: 5, text: "She walks in" },
      { startSeconds: 5, endSeconds: 9, text: "She sits" },
    ]),
  );
  const study = setup();
  await vi.waitFor(() => expect(els.study.list.children).toHaveLength(2));
  return study;
}

export function hangingStudy(): { deps: () => RunDeps | undefined } {
  let captured: RunDeps | undefined;
  vi.mocked(runStudy).mockImplementationOnce(
    (deps) =>
      new Promise((resolve) => {
        captured = deps;
        deps.signal.addEventListener("abort", () => resolve(deps.timeline));
      }),
  );
  return { deps: () => captured };
}

export function startStudy(): void {
  els.study.dialog.returnValue = "start";
  els.study.dialog.dispatchEvent(new Event("close"));
}

export const menuToggle = () => document.querySelector<HTMLButtonElement>(".study-menu-button");
export const removeItem = () => document.querySelector<HTMLButtonElement>(".study-remove");
export const shownItems = () =>
  [...document.querySelectorAll<HTMLButtonElement>(".study-menu-item")]
    .filter((item) => !item.hidden)
    .map((item) => item.textContent.trim());
export const restartItem = () => document.querySelector<HTMLButtonElement>(".study-restart");

export function setInput(input: HTMLInputElement | HTMLSelectElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event("input"));
}

export function pricedModels(): void {
  setModels(state, [
    {
      ...model(STUDY_MODEL_ID),
      pricing: { inputPerMTok: 100, outputPerMTok: 100 },
    },
  ]);
}

export function progressingStudy(nextWindow: number): { deps: () => RunDeps | undefined } {
  let captured: RunDeps | undefined;
  vi.mocked(runStudy).mockImplementationOnce(
    (deps) =>
      new Promise((resolve) => {
        captured = deps;
        const progress = {
          ...deps.timeline,
          entries: [{ startSeconds: 0, endSeconds: 5, text: "She walks in" }],
          nextWindow,
          usage: { promptTokens: 1000, completionTokens: 234 },
        };
        deps.onProgress(progress);
        deps.signal.addEventListener("abort", () => resolve(progress));
      }),
  );
  return { deps: () => captured };
}

export const FLAGS: UnclearSpan[] = [
  { startSeconds: 4, endSeconds: 6, reason: "a quick gesture" },
  { startSeconds: 300, endSeconds: 302, reason: "a sign too small to read" },
];

export function offerFor(unclear: UnclearSpan[], modelId = "m"): string {
  const chat = state.currentChat;
  if (!chat) throw new Error("No chat");
  const zoomModel = resolveModel(state, modelId);
  return zoomOfferText(
    planZoom({
      durationSeconds: VIDEO.durationSeconds,
      sourceAspect: VIDEO.width / VIDEO.height,
      resolution: resolveSheetResolution(chat.settings.sheetResolution, zoomModel).px,
      model: zoomModel,
      unclear,
    }),
  );
}

export const zoomItem = () => document.querySelector<HTMLButtonElement>(".study-zoom");

export async function flaggedStudy(unclear: UnclearSpan[]): Promise<Study> {
  await store.putTimeline({
    ...timeline([
      { startSeconds: 0, endSeconds: 5, text: "She walks in" },
      { startSeconds: 5, endSeconds: 9, text: "She sits", zoomed: true },
    ]),
    unclear,
  });
  const study = setup();
  await vi.waitFor(() => expect(els.study.summary.textContent).toBe("Timeline for beach.mp4 (2)"));
  return study;
}

export function hangingZoom(): { deps: () => ZoomDeps | undefined } {
  let captured: ZoomDeps | undefined;
  vi.mocked(runZoom).mockImplementationOnce(
    (deps) =>
      new Promise((resolve) => {
        captured = deps;
        const first = FLAGS[0];
        const progress = {
          ...deps.timeline,
          unclear: [...(first ? [{ ...first, zoomed: true as const }] : []), ...FLAGS.slice(1)],
        };
        deps.onProgress(progress);
        deps.signal.addEventListener("abort", () => resolve(progress));
      }),
  );
  return { deps: () => captured };
}
