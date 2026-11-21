import { readFrameTimes } from "@vid2grid/browser";
import type { AudioAnalysisProgress, VideoInfo } from "@vid2grid/core";
import {
  AUDIO_PIECE_SECONDS,
  audioProgressText,
  ensureAudio,
  settingsLabels,
  type AnalyseAudio,
  type AudioDeps,
} from "../audio/videoAudio";
import { currentModel, resolveModel } from "../chat/models";
import type { AppElements } from "../dom";
import {
  isRunningIn,
  overviewFor,
  pendingFor,
  pendingVideo,
  removePendingVideo,
  setLoadedVideo,
  setOverviewStatus,
  setPendingVideo,
  shownVideo,
  updateChat,
  type AppState,
  type OverviewStatus,
} from "../state";
import { errorText } from "../text";
import { formatTimestamp } from "../time";
import type { Chat, ChatStore, ImageRef, ModelInfo, VideoAttachment } from "../types";
import { fileKey, probeAttachment, renderSheets } from "../video/render";
import { resolveOverviewResolution, resolveSheetResolution } from "../video/resolution";
import { renderOverview, type ToolContext } from "../video/tools";
import { storedAudioOn } from "./composer";
import { createCoverageStrip, type CoverageStrip } from "./coverageStrip";
import { initMiniPlayer, playQuietly, videoAspect, type MiniPlayer } from "./miniPlayer";
import type { StatusLine } from "./status";
import { NEEDS_MODEL_TEXT, overviewText } from "./video/overviewText";

const AGAIN_TEXT = "Click Reattach again to choose the file.";
const VIDEO_PICKER_TYPES = [
  { description: "Video", accept: { "video/*": [".mp4", ".webm", ".mov", ".mkv", ".m4v"] } },
];

export interface VideoView {
  video: VideoAttachment | undefined;
  url: string | null;
}

export interface VideoPanel {
  restore(): Promise<void>;
  // Adds the video to the message being written; the chat keeps its own video until it is sent.
  attach(file: File, handle?: FileSystemFileHandle): Promise<void>;
  // Makes the sent video the chat's own, saving it before anything in memory changes.
  commit(chatId: string, video: VideoAttachment): Promise<void>;
  reattach(): Promise<void>;
  // A video other than the chat's current one plays from a kept copy, leaving the chat as it is.
  seek(seconds: number, video?: VideoAttachment): void;
  // Moves the player to a moment without playing, for when something covers it.
  cue(seconds: number): void;
  openPlayer(seconds?: number): void;
  // Undefined while the mini-player shows an earlier video instead of the attached one.
  attachedPlaybackTime(): number | undefined;
  view(): VideoView;
  pendingView(): VideoView;
  render(): void;
  renderCoverage(): void;
  overviewRendering(): boolean;
  whenOverviewReady(): Promise<void>;
}

export interface VideoPanelDeps {
  store: ChatStore;
  status: StatusLine;
  onChatChanged(): void;
  onVideoChanged(): void;
  onOverview(chatId: string, refs: ImageRef[]): void;
  onOverviewProgress(): void;
  studyStatus(): string;
  copyStatus(fileKey: string): string;
  loadCopy(fileKey: string): Promise<File | undefined>;
  onAttached(file: File, video: VideoAttachment): void;
  onCommitted(file: File, video: VideoAttachment, replaced: VideoAttachment | undefined): void;
  probe?: typeof probeAttachment;
  renderOverview?: typeof renderOverview;
  renderSheets?: typeof renderSheets;
  readFrameTimes?: typeof readFrameTimes;
  audioWanted?: () => boolean;
  analyseAudio?: AnalyseAudio;
}

interface LoadedFile {
  file: File;
  info: VideoInfo;
}

interface PendingFile extends LoadedFile {
  video: VideoAttachment;
  handle: FileSystemFileHandle | undefined;
}

interface SheetSource extends LoadedFile {
  video: VideoAttachment;
}

interface Render {
  fileKey: string;
  done: Promise<void>;
}

interface OlderVideo {
  video: VideoAttachment;
  file: File;
  url: string;
}

interface AudioPrep {
  chatId: string;
  fileKey: string;
  controller: AbortController;
  text: string;
}

interface VideoPanelContext {
  els: Pick<AppElements, "video" | "miniPlayer">;
  state: AppState;
  deps: VideoPanelDeps;
  objectUrl: string | null;
  files: Map<string, LoadedFile>;
  // Dropped into the message being written, by chat, until sent or removed.
  pendingFiles: Map<string, PendingFile>;
  pendingUrl: { file: File; url: string } | null;
  renders: Map<string, Render>;
  // Keyed by File, so a changed video never reuses the old frame times and they go with it.
  frameTimes: WeakMap<File, number[] | undefined>;
  // Chats whose saved handle is stale or refused, so Reattach goes straight to the picker.
  skipHandle: Set<string>;
  // Every file loaded this session, by file key, so an earlier video can play without a copy.
  sessionFiles: Map<string, File>;
  // An earlier video of the chat playing in the mini-player in place of the current one.
  playing: { older: OlderVideo | undefined };
  seekToken: number;
  audioPrep: AudioPrep | undefined;
  player: MiniPlayer;
  coverage: CoverageStrip;
}

export function toolContext(state: AppState, store: ChatStore): ToolContext | undefined {
  const chat = state.currentChat;
  const model = currentModel(state);
  if (!chat?.video || state.video?.chatId !== chat.id || model === null) return undefined;
  return sheetContext(chat, model, { ...state.video, video: chat.video }, store);
}

function sheetContext(
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

function chatModel(state: AppState, chat: Chat): ModelInfo | null {
  return chat.settings.modelId === "" ? null : resolveModel(state, chat.settings.modelId);
}

export function initVideoPanel(
  els: Pick<AppElements, "video" | "miniPlayer">,
  state: AppState,
  deps: VideoPanelDeps,
): VideoPanel {
  const playing: VideoPanelContext["playing"] = { older: undefined };
  const shown = () => {
    const chat = state.currentChat;
    return playing.older?.video ?? (chat ? shownVideo(state, chat.id) : undefined);
  };
  const ctx: VideoPanelContext = {
    els,
    state,
    deps,
    objectUrl: null,
    files: new Map(),
    pendingFiles: new Map(),
    pendingUrl: null,
    renders: new Map(),
    frameTimes: new WeakMap(),
    skipHandle: new Set(),
    sessionFiles: new Map(),
    playing,
    seekToken: 0,
    audioPrep: undefined,
    player: initMiniPlayer(els, {
      durationSeconds: () => shown()?.durationSeconds ?? 0,
      frameTimes: () =>
        playing.older ? ctx.frameTimes.get(playing.older.file) : loadedFrameTimes(ctx),
      aspect: () => videoAspect(shown()),
    }),
    coverage: createCoverageStrip({ onSeek: (seconds) => openPlayer(ctx, seconds) }),
  };
  listen(ctx);
  render(ctx);
  const { coverage } = ctx;
  els.miniPlayer.video.after(coverage.el);
  coverage.follow(els.miniPlayer.video);
  return {
    restore: () => restore(ctx),
    attach: (file, handle) => attach(ctx, file, handle),
    commit: (chatId, video) => commit(ctx, chatId, video),
    reattach: () => requestReattach(ctx),
    seek: (seconds, video) => seekMoment(ctx, seconds, video),
    cue: (seconds) => openAtTimestamp(ctx, seconds, false),
    openPlayer: (seconds) => openPlayer(ctx, seconds),
    attachedPlaybackTime: () =>
      playing.older || showingPending(ctx) ? undefined : els.miniPlayer.video.currentTime,
    view: () => ({
      video: state.currentChat?.video,
      url: committedLoaded(ctx) ? ctx.objectUrl : null,
    }),
    pendingView: () => pendingView(ctx),
    render: () => render(ctx),
    renderCoverage: () =>
      coverage.update(state.messages, state.currentChat?.video?.durationSeconds),
    overviewRendering: () => currentRender(ctx) !== undefined,
    whenOverviewReady: () => currentRender(ctx)?.done ?? Promise.resolve(),
  };
}

function pendingView(ctx: VideoPanelContext): VideoView {
  const pending = currentPendingFile(ctx);
  return { video: pending?.video, url: pending ? pendingUrlOf(ctx, pending.file) : null };
}

// Null until render has made the URL for this file, so another chat's revoked URL is never used.
function pendingUrlOf(ctx: VideoPanelContext, file: File): string | null {
  return ctx.pendingUrl?.file === file ? ctx.pendingUrl.url : null;
}

function listen(ctx: VideoPanelContext): void {
  const { chip, reattachInput } = ctx.els.video;
  chip.addEventListener("click", () => {
    if (isMissing(ctx)) void requestReattach(ctx);
    else openPlayer(ctx);
  });
  reattachInput.addEventListener("change", () => {
    const file = reattachInput.files?.[0];
    reattachInput.value = "";
    if (!file) return;
    attach(ctx, file).catch((error: unknown) => {
      ctx.deps.status.show(`Could not attach ${file.name}: ${errorText(error)}`, "error");
    });
  });
  ctx.els.miniPlayer.close.addEventListener("click", () => closePlayer(ctx));
}

function isDomError(error: unknown, ...names: string[]): boolean {
  return error instanceof DOMException && names.includes(error.name);
}

function infoFrom(video: VideoAttachment): VideoInfo {
  return { durationSeconds: video.durationSeconds, width: video.width, height: video.height };
}

function isCurrent(ctx: VideoPanelContext, chatId: string): boolean {
  return ctx.state.currentChat?.id === chatId;
}

function committedLoaded(ctx: VideoPanelContext): boolean {
  const chat = ctx.state.currentChat;
  return chat !== null && ctx.state.video?.chatId === chat.id;
}

function isMissing(ctx: VideoPanelContext): boolean {
  const chat = ctx.state.currentChat;
  return (
    chat?.video !== undefined && !committedLoaded(ctx) && currentPendingFile(ctx) === undefined
  );
}

function attachedVideo(ctx: VideoPanelContext, chatId: string): VideoAttachment | undefined {
  return ctx.state.chats.find((chat) => chat.id === chatId)?.video;
}

function currentShownVideo(ctx: VideoPanelContext): VideoAttachment | undefined {
  const chat = ctx.state.currentChat;
  return chat ? shownVideo(ctx.state, chat.id) : undefined;
}

function pendingFileOf(ctx: VideoPanelContext, chatId: string): PendingFile | undefined {
  const pending = ctx.pendingFiles.get(chatId);
  const wanted = pendingVideo(pendingFor(ctx.state, chatId));
  return pending && wanted?.fileKey === pending.video.fileKey ? pending : undefined;
}

function currentPendingFile(ctx: VideoPanelContext): PendingFile | undefined {
  const chat = ctx.state.currentChat;
  return chat ? pendingFileOf(ctx, chat.id) : undefined;
}

function showingPending(ctx: VideoPanelContext): boolean {
  const url = ctx.pendingUrl?.url;
  return url !== undefined && ctx.els.miniPlayer.video.getAttribute("src") === url;
}

function sheetSource(ctx: VideoPanelContext, chatId: string): SheetSource | undefined {
  const pending = pendingFileOf(ctx, chatId);
  if (pending) return pending;
  const video = attachedVideo(ctx, chatId);
  const loaded = ctx.files.get(chatId);
  return video && loaded && fileKey(loaded.file) === video.fileKey
    ? { ...loaded, video }
    : undefined;
}

function currentRender(ctx: VideoPanelContext): Render | undefined {
  const chat = ctx.state.currentChat;
  const pending = chat ? ctx.renders.get(chat.id) : undefined;
  return pending && pending.fileKey === currentShownVideo(ctx)?.fileKey ? pending : undefined;
}

async function saveChat(
  ctx: VideoPanelContext,
  chatId: string,
  change: (chat: Chat) => Chat,
): Promise<void> {
  await updateChat(ctx.state, ctx.deps.store, chatId, change);
  ctx.deps.onChatChanged();
}

async function restore(ctx: VideoPanelContext): Promise<void> {
  setUrl(ctx, null);
  render(ctx);
  const chat = ctx.state.currentChat;
  if (!chat?.video) return;
  const cached = ctx.files.get(chat.id);
  if (cached) {
    load(ctx, chat.id, cached);
    return;
  }
  try {
    // A stored copy opens without any permission prompt, so it is tried before the saved handle.
    const copy = await ctx.deps.loadCopy(chat.video.fileKey);
    if (copy && (await reattachedFromCopy(ctx, chat.id, copy))) return;
    const handle = await ctx.deps.store.getVideoHandle(chat.id);
    if (!handle || ctx.skipHandle.has(chat.id)) {
      showStillMissing(ctx, chat.id, `This browser kept no copy of ${chat.video.name}.`);
      return;
    }
    if ((await handle.queryPermission?.({ mode: "read" })) !== "granted") {
      const why = `The browser needs your permission to read ${chat.video.name} again.`;
      showStillMissing(ctx, chat.id, why);
      return;
    }
    if (!(await reattachFromHandle(ctx, chat.id, handle)) && isCurrent(ctx, chat.id)) {
      ctx.deps.status.show(`${chat.video.name} was moved or renamed. Use Reattach to find it.`);
    }
  } catch (error) {
    if (isCurrent(ctx, chat.id)) {
      ctx.deps.status.show(`Could not reopen ${chat.video.name}: ${errorText(error)}`, "error");
    }
  }
}

function showStillMissing(ctx: VideoPanelContext, chatId: string, why: string): void {
  if (isCurrent(ctx, chatId) && isMissing(ctx)) {
    ctx.deps.status.show(`${why} Click Reattach on the video to open it.`);
  }
}

// A stored copy that cannot be opened is passed over, so the saved handle still gets its turn.
async function reattachedFromCopy(
  ctx: VideoPanelContext,
  chatId: string,
  copy: File,
): Promise<boolean> {
  try {
    await reattach(ctx, chatId, copy);
  } catch {
    return false;
  }
  return ctx.state.video?.chatId === chatId;
}

async function fileFromHandle(handle: FileSystemFileHandle): Promise<File | undefined> {
  try {
    return await handle.getFile();
  } catch (error) {
    if (isDomError(error, "NotFoundError", "NotReadableError")) return undefined;
    throw error;
  }
}

// False when the handle no longer leads to this chat's video, so the caller falls back to a picker.
async function reattachFromHandle(
  ctx: VideoPanelContext,
  chatId: string,
  handle: FileSystemFileHandle,
): Promise<boolean> {
  const file = await fileFromHandle(handle);
  if (!file || file.name !== attachedVideo(ctx, chatId)?.name) {
    ctx.skipHandle.add(chatId);
    return false;
  }
  await reattach(ctx, chatId, file);
  return true;
}

async function attach(
  ctx: VideoPanelContext,
  file: File,
  handle?: FileSystemFileHandle,
): Promise<void> {
  const chat = ctx.state.currentChat;
  if (!chat) return;
  const key = fileKey(file);
  if (chat.video?.fileKey === key) {
    dropPending(ctx, chat.id);
    if (handle) await saveHandle(ctx, chat.id, handle);
    load(ctx, chat.id, { file, info: infoFrom(chat.video) });
    return;
  }
  if (isRunningIn(ctx.state, chat.id)) {
    ctx.deps.status.show("Stop or wait for the reply before changing the video.", "error");
    return;
  }
  const same = pendingFileOf(ctx, chat.id);
  if (same?.video.fileKey === key) {
    ctx.pendingFiles.set(chat.id, { ...same, handle: handle ?? same.handle });
    return;
  }
  const probed = await probe(ctx, file);
  if (!probed || !ctx.state.chats.some((entry) => entry.id === chat.id)) return;
  dropPending(ctx, chat.id);
  ctx.pendingFiles.set(chat.id, { file, info: probed.info, video: probed.attachment, handle });
  setPendingVideo(ctx.state, chat.id, probed.attachment);
  ctx.sessionFiles.set(key, file);
  readFrameTimesOf(ctx, file);
  render(ctx);
  ctx.deps.onVideoChanged();
  startOverview(ctx, chat.id);
  ctx.deps.onAttached(file, probed.attachment);
}

function dropPending(ctx: VideoPanelContext, chatId: string): void {
  removePendingVideo(ctx.state, chatId);
  ctx.pendingFiles.delete(chatId);
}

// Removed pending videos are let go; the chat's own video was never touched.
function dropStalePending(ctx: VideoPanelContext): void {
  for (const [chatId, pending] of ctx.pendingFiles) {
    if (pendingVideo(pendingFor(ctx.state, chatId))?.fileKey === pending.video.fileKey) continue;
    ctx.pendingFiles.delete(chatId);
  }
}

// Saved before memory changes, so a failed save leaves the chat and the message as they were.
async function commit(
  ctx: VideoPanelContext,
  chatId: string,
  video: VideoAttachment,
): Promise<void> {
  const pending = ctx.pendingFiles.get(chatId);
  const latest = ctx.state.chats.find((chat) => chat.id === chatId);
  if (pending?.video.fileKey !== video.fileKey || !latest) return;
  const previous = latest.video;
  // Scene notes carry no video key, so notes about the previous video would read as this one's.
  const withVideo = (entry: Chat): Chat => ({
    ...entry,
    video,
    sceneLog: entry.video?.fileKey === video.fileKey ? entry.sceneLog : [],
  });
  await ctx.deps.store.putChat(withVideo(latest));
  if (pending.handle) await saveHandle(ctx, chatId, pending.handle);
  else await ctx.deps.store.deleteVideoHandle(chatId);
  // Applied again to the newest copy, so a change another writer saved meanwhile is kept.
  await updateChat(ctx.state, ctx.deps.store, chatId, withVideo);
  ctx.pendingFiles.delete(chatId);
  load(ctx, chatId, { file: pending.file, info: pending.info });
  ctx.deps.onChatChanged();
  ctx.deps.onCommitted(pending.file, video, previous);
}

async function saveHandle(
  ctx: VideoPanelContext,
  chatId: string,
  handle: FileSystemFileHandle,
): Promise<void> {
  await ctx.deps.store.putVideoHandle(chatId, handle);
  ctx.skipHandle.delete(chatId);
}

async function reattach(ctx: VideoPanelContext, chatId: string, file: File): Promise<void> {
  const chat = ctx.state.currentChat;
  if (!chat?.video || chat.id !== chatId) return;
  if (fileKey(file) === chat.video.fileKey) {
    load(ctx, chatId, { file, info: infoFrom(chat.video) });
    return;
  }
  const probed = await probe(ctx, file);
  const latest = ctx.state.currentChat;
  if (!probed || latest?.id !== chatId) return;
  await saveChat(ctx, chatId, (entry) => ({ ...entry, video: probed.attachment }));
  load(ctx, chatId, { file, info: probed.info });
  ctx.deps.status.show(
    `${file.name} has changed since it was attached, so earlier sheets may not match it.`,
    "error",
  );
}

async function probe(
  ctx: VideoPanelContext,
  file: File,
): Promise<Awaited<ReturnType<typeof probeAttachment>> | undefined> {
  ctx.deps.status.show(`Reading ${file.name}…`);
  try {
    const probed = await (ctx.deps.probe ?? probeAttachment)(file);
    ctx.deps.status.clear();
    return probed;
  } catch (error) {
    ctx.deps.status.show(`Could not read ${file.name}: ${errorText(error)}`, "error");
    return undefined;
  }
}

async function requestReattach(ctx: VideoPanelContext): Promise<void> {
  const chat = ctx.state.currentChat;
  if (!chat?.video) return;
  try {
    if (await reattachWithPermission(ctx, chat.id)) return;
    await pickVideo(ctx);
  } catch (error) {
    // The permission prompt can use up the click, so the picker may refuse to open.
    if (isDomError(error, "SecurityError", "NotAllowedError")) {
      ctx.skipHandle.add(chat.id);
      ctx.deps.status.show(AGAIN_TEXT, "error");
    } else {
      ctx.deps.status.show(`Could not reattach the video: ${errorText(error)}`, "error");
    }
  }
}

async function reattachWithPermission(ctx: VideoPanelContext, chatId: string): Promise<boolean> {
  if (ctx.skipHandle.has(chatId)) return false;
  const handle = await ctx.deps.store.getVideoHandle(chatId);
  if (!handle) return false;
  const permission = (await handle.requestPermission?.({ mode: "read" })) ?? "granted";
  if (permission !== "granted") {
    ctx.skipHandle.add(chatId);
    ctx.deps.status.show(`Reading the saved file was not allowed. ${AGAIN_TEXT}`, "error");
    return true;
  }
  return reattachFromHandle(ctx, chatId, handle);
}

async function pickVideo(ctx: VideoPanelContext): Promise<void> {
  if (!window.showOpenFilePicker) {
    ctx.els.video.reattachInput.click();
    return;
  }
  let picked: FileSystemFileHandle | undefined;
  try {
    [picked] = await window.showOpenFilePicker({ types: VIDEO_PICKER_TYPES });
  } catch (error) {
    if (isDomError(error, "AbortError")) return;
    throw error;
  }
  if (picked) await attach(ctx, await picked.getFile(), picked);
}

function load(ctx: VideoPanelContext, chatId: string, loaded: LoadedFile): void {
  ctx.files.set(chatId, loaded);
  ctx.sessionFiles.set(fileKey(loaded.file), loaded.file);
  readFrameTimesOf(ctx, loaded.file);
  if (!isCurrent(ctx, chatId)) return;
  setLoadedVideo(ctx.state, { chatId, ...loaded });
  setUrl(ctx, loaded.file);
  render(ctx);
  ctx.deps.onVideoChanged();
}

// Read from the renderer's own File, so the two share one demux.
function readFrameTimesOf(ctx: VideoPanelContext, file: File): void {
  if (ctx.frameTimes.has(file)) return;
  ctx.frameTimes.set(file, undefined);
  const read = ctx.deps.readFrameTimes ?? readFrameTimes;
  Promise.resolve()
    .then(() => read(file))
    .then((times) => ctx.frameTimes.set(file, times))
    .catch(() => undefined);
}

function loadedFrameTimes(ctx: VideoPanelContext): number[] | undefined {
  const pending = currentPendingFile(ctx);
  if (pending) return ctx.frameTimes.get(pending.file);
  const loaded = ctx.state.video;
  if (!loaded || loaded.chatId !== ctx.state.currentChat?.id) return undefined;
  return ctx.frameTimes.get(loaded.file);
}

function setUrl(ctx: VideoPanelContext, file: File | null): void {
  closePlayer(ctx);
  const player = ctx.els.miniPlayer.video;
  player.removeAttribute("src");
  ctx.player.reset();
  if (ctx.objectUrl) URL.revokeObjectURL(ctx.objectUrl);
  ctx.objectUrl = file ? URL.createObjectURL(file) : null;
}

// Keeps one object URL for the current chat's pending file, so its thumbnail and player share it.
function syncPendingUrl(ctx: VideoPanelContext): void {
  const file = currentPendingFile(ctx)?.file;
  const previous = ctx.pendingUrl;
  if (previous?.file === file) return;
  if (previous) {
    if (showingPending(ctx)) {
      closePlayer(ctx);
      ctx.els.miniPlayer.video.removeAttribute("src");
      ctx.player.reset();
    }
    URL.revokeObjectURL(previous.url);
  }
  ctx.pendingUrl = file ? { file, url: URL.createObjectURL(file) } : null;
}

function shownUrl(ctx: VideoPanelContext): string | null {
  const pending = currentPendingFile(ctx);
  if (pending) return pendingUrlOf(ctx, pending.file);
  return isMissing(ctx) ? null : ctx.objectUrl;
}

function openPlayer(ctx: VideoPanelContext, seconds?: number, play = true): void {
  ctx.seekToken += 1;
  const video = currentShownVideo(ctx);
  const url = shownUrl(ctx);
  if (!video || !url) {
    const where = seconds === undefined ? "play it" : `jump to ${formatTimestamp(seconds)}`;
    ctx.deps.status.show(`Reattach the video to ${where}.`);
    return;
  }
  releaseOlder(ctx);
  const { el: miniPlayer, title: miniPlayerTitle, video: miniPlayerVideo } = ctx.els.miniPlayer;
  if (miniPlayerVideo.getAttribute("src") !== url) miniPlayerVideo.src = url;
  // The coverage strip marks the chat's own video, not one waiting to be sent.
  ctx.coverage.el.hidden = showingPending(ctx);
  miniPlayerTitle.textContent = video.name;
  miniPlayer.hidden = false;
  ctx.player.layout();
  if (seconds !== undefined) {
    miniPlayerVideo.currentTime = Math.min(Math.max(0, seconds), video.durationSeconds);
  }
  if (play) playQuietly(miniPlayerVideo);
  else miniPlayerVideo.pause();
}

function openAtTimestamp(ctx: VideoPanelContext, seconds: number, play: boolean): void {
  openPlayer(ctx, seconds, play);
  if (!ctx.els.miniPlayer.el.hidden) ctx.player.offerLoopAround(seconds);
}

function seekMoment(ctx: VideoPanelContext, seconds: number, video?: VideoAttachment): void {
  const target = video ?? ctx.state.currentChat?.video;
  if (!target || target.fileKey === currentShownVideo(ctx)?.fileKey) {
    openAtTimestamp(ctx, seconds, true);
  } else {
    openOlder(ctx, target, seconds).catch((error: unknown) => {
      ctx.deps.status.show(`Could not open ${target.name}: ${errorText(error)}`, "error");
    });
  }
}

async function openOlder(
  ctx: VideoPanelContext,
  video: VideoAttachment,
  seconds: number,
): Promise<void> {
  ctx.seekToken += 1;
  const token = ctx.seekToken;
  const chatId = ctx.state.currentChat?.id;
  const file =
    ctx.sessionFiles.get(video.fileKey) ??
    (await ctx.deps.loadCopy(video.fileKey).catch(() => undefined));
  if (token !== ctx.seekToken || ctx.state.currentChat?.id !== chatId) return;
  if (!file) {
    ctx.deps.status.show(
      `That moment is in ${video.name}, which isn't attached now. Attach it again to jump there.`,
    );
    return;
  }
  playOlder(ctx, { video, file, url: URL.createObjectURL(file) }, seconds);
}

function playOlder(ctx: VideoPanelContext, older: OlderVideo, seconds: number): void {
  releaseOlder(ctx);
  ctx.playing.older = older;
  readFrameTimesOf(ctx, older.file);
  const { el: miniPlayer, title: miniPlayerTitle, video: miniPlayerVideo } = ctx.els.miniPlayer;
  ctx.player.reset();
  miniPlayerVideo.src = older.url;
  miniPlayerTitle.textContent = older.video.name;
  ctx.coverage.el.hidden = true;
  miniPlayer.hidden = false;
  ctx.player.layout();
  miniPlayerVideo.currentTime = Math.min(Math.max(0, seconds), older.video.durationSeconds);
  playQuietly(miniPlayerVideo);
  ctx.player.offerLoopAround(seconds);
}

function releaseOlder(ctx: VideoPanelContext): void {
  const { older } = ctx.playing;
  if (!older) return;
  ctx.playing.older = undefined;
  const player = ctx.els.miniPlayer.video;
  if (player.getAttribute("src") === older.url) {
    player.pause();
    player.removeAttribute("src");
    ctx.player.reset();
  }
  URL.revokeObjectURL(older.url);
  ctx.coverage.el.hidden = false;
}

function closePlayer(ctx: VideoPanelContext): void {
  const { el: miniPlayer, video: miniPlayerVideo } = ctx.els.miniPlayer;
  releaseOlder(ctx);
  if (miniPlayer.hidden) return;
  miniPlayerVideo.pause();
  miniPlayer.hidden = true;
  ctx.player.reset();
}

function render(ctx: VideoPanelContext): void {
  dropStalePending(ctx);
  syncPendingUrl(ctx);
  startWaitingOverviews(ctx);
  dropStaleAudio(ctx);
  renderChip(ctx);
}

function renderChip(ctx: VideoPanelContext): void {
  const { chip, chipName, chipMeta } = ctx.els.video;
  const chat = ctx.state.currentChat;
  const video = currentShownVideo(ctx);
  chip.hidden = !chat || !video;
  if (!chat || !video) return;
  const missing = isMissing(ctx);
  chip.classList.toggle("is-missing", missing);
  chipName.textContent = video.name;
  const status = overviewFor(ctx.state, chat.id);
  const pending = pendingVideo(pendingFor(ctx.state, chat.id)) !== undefined;
  const overview = status?.kind === "ready" && !pending ? "" : overviewText(status);
  const study = ctx.deps.studyStatus();
  const copy = ctx.deps.copyStatus(video.fileKey);
  const audio = ctx.audioPrep?.chatId === chat.id ? ctx.audioPrep.text : "";
  chipMeta.textContent = missing
    ? "Reattach"
    : [formatTimestamp(video.durationSeconds), overview, study, audio, copy]
        .filter((part) => part !== "")
        .join(" · ");
  chip.title = missing
    ? `${video.name} is not loaded. Click to reattach it.`
    : `Open ${video.name} in the player`;
}

// An overview waiting for a model starts once the chat has one.
function startWaitingOverviews(ctx: VideoPanelContext): void {
  for (const [chatId, status] of ctx.state.overviews) {
    const chat = ctx.state.chats.find((entry) => entry.id === chatId);
    if (status.kind !== "needsModel" || overviewFor(ctx.state, chatId) !== status) continue;
    if (chat && chatModel(ctx.state, chat) !== null) startOverview(ctx, chatId);
  }
}

function startOverview(ctx: VideoPanelContext, chatId: string): void {
  const chat = ctx.state.chats.find((entry) => entry.id === chatId);
  const source = sheetSource(ctx, chatId);
  if (!chat || !source) return;
  const key = source.video.fileKey;
  const stillShown = () => shownVideo(ctx.state, chatId)?.fileKey === key;
  const report = (status: OverviewStatus) => {
    if (!stillShown()) return;
    setOverviewStatus(ctx.state, chatId, status);
    if (isCurrent(ctx, chatId)) renderChip(ctx);
    ctx.deps.onOverviewProgress();
  };
  const model = chatModel(ctx.state, chat);
  if (model === null) {
    report({ kind: "needsModel", fileKey: key });
    if (isCurrent(ctx, chatId)) ctx.deps.status.show(`${NEEDS_MODEL_TEXT}.`);
    return;
  }
  let rendered = false;
  const renderFresh = ctx.deps.renderSheets ?? renderSheets;
  const toolCtx: ToolContext = {
    ...sheetContext(chat, model, source, ctx.deps.store),
    render: (...args) => {
      rendered = true;
      return renderFresh(...args);
    },
  };
  const render = ctx.deps.renderOverview ?? renderOverview;
  report({ kind: "rendering", fileKey: key, done: 0, total: 0 });
  const done = render(toolCtx, (finished, total) => {
    report({ kind: "rendering", fileKey: key, done: finished, total });
  })
    .then((refs) => {
      if (!stillShown()) return;
      report({
        kind: "ready",
        fileKey: key,
        sheets: refs.length,
        ...(rendered ? {} : { reused: true as const }),
      });
      ctx.deps.onOverview(chatId, refs);
      prepareAudio(ctx, chatId, toolCtx);
    })
    .catch((error: unknown) => {
      report({ kind: "failed", fileKey: key, error: errorText(error) });
    })
    .finally(() => {
      if (ctx.renders.get(chatId)?.done === done) ctx.renders.delete(chatId);
    });
  ctx.renders.set(chatId, { fileKey: key, done });
}

function stopAudioPrep(ctx: VideoPanelContext): void {
  ctx.audioPrep?.controller.abort();
  ctx.audioPrep = undefined;
}

function dropStaleAudio(ctx: VideoPanelContext): void {
  const prep = ctx.audioPrep;
  if (!prep) return;
  const still =
    isCurrent(ctx, prep.chatId) && shownVideo(ctx.state, prep.chatId)?.fileKey === prep.fileKey;
  if (!still) stopAudioPrep(ctx);
}

function showAudioPrep(ctx: VideoPanelContext, prep: AudioPrep, text: string): void {
  if (ctx.audioPrep !== prep) return;
  prep.text = text;
  if (isCurrent(ctx, prep.chatId)) renderChip(ctx);
}

// Analysed ahead so a later turn can listen without waiting; a failure here stays quiet.
function prepareAudio(ctx: VideoPanelContext, chatId: string, toolCtx: ToolContext): void {
  if (!(ctx.deps.audioWanted ?? storedAudioOn)() || !isCurrent(ctx, chatId)) return;
  stopAudioPrep(ctx);
  const prep: AudioPrep = {
    chatId,
    fileKey: toolCtx.video.fileKey,
    controller: new AbortController(),
    text: "Getting the audio ready…",
  };
  ctx.audioPrep = prep;
  renderChip(ctx);
  void hearWholeVideo(ctx, prep, toolCtx)
    .catch(() => undefined)
    .finally(() => {
      if (ctx.audioPrep !== prep) return;
      ctx.audioPrep = undefined;
      if (isCurrent(ctx, chatId)) renderChip(ctx);
    });
}

function piecePrefix(index: number, pieces: number): string {
  return pieces > 1 ? `Audio ${index + 1} of ${pieces}: ` : "";
}

// One piece per call, so a turn's listen call can run between pieces instead of after them all.
async function hearWholeVideo(
  ctx: VideoPanelContext,
  prep: AudioPrep,
  toolCtx: ToolContext,
): Promise<void> {
  const deps: AudioDeps = {
    store: ctx.deps.store,
    labels: settingsLabels(ctx.state.settings),
    ...(ctx.deps.analyseAudio ? { analyse: ctx.deps.analyseAudio } : {}),
  };
  const durationSeconds = toolCtx.video.durationSeconds;
  const source = { file: toolCtx.file, fileKey: prep.fileKey, durationSeconds };
  const pieces = Math.max(1, Math.ceil(durationSeconds / AUDIO_PIECE_SECONDS));
  for (let index = 0; index < pieces; index++) {
    const range = {
      startSeconds: index * AUDIO_PIECE_SECONDS,
      endSeconds: Math.min(durationSeconds, (index + 1) * AUDIO_PIECE_SECONDS),
    };
    const onProgress = (progress: AudioAnalysisProgress) =>
      showAudioPrep(ctx, prep, `${piecePrefix(index, pieces)}${audioProgressText(progress)}`);
    const audio = await ensureAudio(deps, source, range, {
      signal: prep.controller.signal,
      onProgress,
    });
    if (audio.noAudio) return;
  }
}
