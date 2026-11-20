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
import type { AppElements, StatusLine } from "../dom";
import {
  currentModel,
  overviewFor,
  overviewText,
  setLoadedVideo,
  setOverviewStatus,
  setPendingVideo,
  updateChat,
  type AppState,
  type OverviewStatus,
} from "../state";
import { errorText } from "../text";
import { formatTimestamp } from "../time";
import type { Chat, ChatStore, ImageRef, VideoAttachment } from "../types";
import { fileKey, probeAttachment } from "../video/render";
import { resolveOverviewResolution, resolveSheetResolution } from "../video/resolution";
import { renderOverview, type ToolContext } from "../video/tools";
import { storedAudioOn } from "./composer";
import { createCoverageStrip, type CoverageStrip } from "./coverageStrip";
import { initMiniPlayer, playQuietly, videoAspect, type MiniPlayer } from "./miniPlayer";

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
  attach(file: File, handle?: FileSystemFileHandle): Promise<void>;
  reattach(): Promise<void>;
  // A video other than the chat's current one plays from a kept copy, leaving the chat as it is.
  seek(seconds: number, video?: VideoAttachment): void;
  // Moves the player to a moment without playing, for when something covers it.
  cue(seconds: number): void;
  openPlayer(seconds?: number): void;
  // Undefined while the mini-player shows an earlier video instead of the attached one.
  attachedPlaybackTime(): number | undefined;
  view(): VideoView;
  render(): void;
  renderCoverage(): void;
  overviewRendering(): boolean;
  whenOverviewReady(): Promise<void>;
}

export interface VideoPanelDeps {
  store: ChatStore;
  status: StatusLine;
  confirm(message: string): boolean;
  onChatChanged(): void;
  onVideoChanged(): void;
  onOverview(chatId: string, refs: ImageRef[]): void;
  onOverviewProgress(): void;
  studyStatus(): string;
  copyStatus(fileKey: string): string;
  loadCopy(fileKey: string): Promise<File | undefined>;
  onAttached(file: File, video: VideoAttachment, replaced: VideoAttachment | undefined): void;
  probe?: typeof probeAttachment;
  renderOverview?: typeof renderOverview;
  readFrameTimes?: typeof readFrameTimes;
  audioWanted?: () => boolean;
  analyseAudio?: AnalyseAudio;
}

interface LoadedFile {
  file: File;
  info: VideoInfo;
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
  els: AppElements["video"];
  state: AppState;
  deps: VideoPanelDeps;
  objectUrl: string | null;
  files: Map<string, LoadedFile>;
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
  return {
    file: state.video.file,
    info: state.video.info,
    video: chat.video,
    resolution: resolveSheetResolution(chat.settings.sheetResolution, model).px,
    overviewResolution: (sheets) =>
      resolveOverviewResolution(chat.settings.sheetResolution, model, sheets).px,
    maxImages: model.maxImages,
    store,
  };
}

export function initVideoPanel(
  els: Pick<AppElements, "video">,
  state: AppState,
  deps: VideoPanelDeps,
): VideoPanel {
  const playing: VideoPanelContext["playing"] = { older: undefined };
  const shown = () => playing.older?.video ?? state.currentChat?.video;
  const ctx: VideoPanelContext = {
    els: els.video,
    state,
    deps,
    objectUrl: null,
    files: new Map(),
    renders: new Map(),
    frameTimes: new WeakMap(),
    skipHandle: new Set(),
    sessionFiles: new Map(),
    playing,
    seekToken: 0,
    audioPrep: undefined,
    player: initMiniPlayer(els.video, {
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
  els.video.miniPlayerVideo.after(coverage.el);
  coverage.follow(els.video.miniPlayerVideo);
  return {
    restore: () => restore(ctx),
    attach: (file, handle) => attach(ctx, file, handle),
    reattach: () => requestReattach(ctx),
    seek: (seconds, video) => seekMoment(ctx, seconds, video),
    cue: (seconds) => openAtTimestamp(ctx, seconds, false),
    openPlayer: (seconds) => openPlayer(ctx, seconds),
    attachedPlaybackTime: () => (playing.older ? undefined : els.video.miniPlayerVideo.currentTime),
    view: () => ({ video: state.currentChat?.video, url: isMissing(ctx) ? null : ctx.objectUrl }),
    render: () => render(ctx),
    renderCoverage: () =>
      coverage.update(state.messages, state.currentChat?.video?.durationSeconds),
    overviewRendering: () => currentRender(ctx) !== undefined,
    whenOverviewReady: () => currentRender(ctx)?.done ?? Promise.resolve(),
  };
}

function listen(ctx: VideoPanelContext): void {
  const { chip, reattachInput, miniPlayerClose } = ctx.els;
  chip.addEventListener("click", () => {
    if (isMissing(ctx)) void requestReattach(ctx);
    else openPlayer(ctx);
  });
  reattachInput.addEventListener("change", () => {
    const file = reattachInput.files?.[0];
    reattachInput.value = "";
    if (file) void attach(ctx, file);
  });
  miniPlayerClose.addEventListener("click", () => closePlayer(ctx));
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

function isMissing(ctx: VideoPanelContext): boolean {
  const chat = ctx.state.currentChat;
  return chat?.video !== undefined && ctx.state.video?.chatId !== chat.id;
}

function attachedVideo(ctx: VideoPanelContext, chatId: string): VideoAttachment | undefined {
  return ctx.state.chats.find((chat) => chat.id === chatId)?.video;
}

function currentRender(ctx: VideoPanelContext): Render | undefined {
  const chat = ctx.state.currentChat;
  const pending = chat ? ctx.renders.get(chat.id) : undefined;
  return pending && pending.fileKey === chat?.video?.fileKey ? pending : undefined;
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
    if (!handle || ctx.skipHandle.has(chat.id)) return;
    if ((await handle.queryPermission?.({ mode: "read" })) !== "granted") return;
    if (!(await reattachFromHandle(ctx, chat.id, handle)) && isCurrent(ctx, chat.id)) {
      ctx.deps.status.show(`${chat.video.name} was moved or renamed. Use Reattach to find it.`);
    }
  } catch (error) {
    if (isCurrent(ctx, chat.id)) {
      ctx.deps.status.show(`Could not reopen ${chat.video.name}: ${errorText(error)}`, "error");
    }
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
  const previous = chat.video;
  if (previous?.fileKey === fileKey(file)) {
    if (handle) await saveHandle(ctx, chat.id, handle);
    load(ctx, chat.id, { file, info: infoFrom(previous) });
    return;
  }
  if (ctx.state.running) {
    ctx.deps.status.show("Stop or wait for the reply before changing the video.", "error");
    return;
  }
  const replacing = `Replace ${previous?.name ?? ""} with ${file.name}? Its scene log is cleared.`;
  if (previous && !ctx.deps.confirm(replacing)) return;
  const probed = await probe(ctx, file);
  const latest = ctx.state.currentChat;
  if (!probed || latest?.id !== chat.id) return;
  if (handle) await saveHandle(ctx, chat.id, handle);
  else await ctx.deps.store.deleteVideoHandle(chat.id);
  await saveChat(ctx, chat.id, (entry) => ({ ...entry, video: probed.attachment, sceneLog: [] }));
  setPendingVideo(ctx.state, chat.id, probed.attachment);
  load(ctx, chat.id, { file, info: probed.info });
  startOverview(ctx, chat.id);
  ctx.deps.onAttached(file, probed.attachment, previous);
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
    ctx.els.reattachInput.click();
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
  const loaded = ctx.state.video;
  if (!loaded || loaded.chatId !== ctx.state.currentChat?.id) return undefined;
  return ctx.frameTimes.get(loaded.file);
}

function setUrl(ctx: VideoPanelContext, file: File | null): void {
  closePlayer(ctx);
  const player = ctx.els.miniPlayerVideo;
  player.removeAttribute("src");
  ctx.player.reset();
  if (ctx.objectUrl) URL.revokeObjectURL(ctx.objectUrl);
  ctx.objectUrl = file ? URL.createObjectURL(file) : null;
}

function openPlayer(ctx: VideoPanelContext, seconds?: number, play = true): void {
  ctx.seekToken += 1;
  const video = ctx.state.currentChat?.video;
  const url = ctx.objectUrl;
  if (!video || !url || isMissing(ctx)) {
    const where = seconds === undefined ? "play it" : `jump to ${formatTimestamp(seconds)}`;
    ctx.deps.status.show(`Reattach the video to ${where}.`);
    return;
  }
  releaseOlder(ctx);
  const { miniPlayer, miniPlayerTitle, miniPlayerVideo } = ctx.els;
  if (miniPlayerVideo.getAttribute("src") !== url) miniPlayerVideo.src = url;
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
  if (!ctx.els.miniPlayer.hidden) ctx.player.offerLoopAround(seconds);
}

function seekMoment(ctx: VideoPanelContext, seconds: number, video?: VideoAttachment): void {
  const current = ctx.state.currentChat?.video;
  if (!video || video.fileKey === current?.fileKey) openAtTimestamp(ctx, seconds, true);
  else void openOlder(ctx, video, seconds);
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
  const { miniPlayer, miniPlayerTitle, miniPlayerVideo } = ctx.els;
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
  const player = ctx.els.miniPlayerVideo;
  if (player.getAttribute("src") === older.url) {
    player.pause();
    player.removeAttribute("src");
    ctx.player.reset();
  }
  URL.revokeObjectURL(older.url);
  ctx.coverage.el.hidden = false;
}

function closePlayer(ctx: VideoPanelContext): void {
  const { miniPlayer, miniPlayerVideo } = ctx.els;
  releaseOlder(ctx);
  if (miniPlayer.hidden) return;
  miniPlayerVideo.pause();
  miniPlayer.hidden = true;
  ctx.player.reset();
}

function render(ctx: VideoPanelContext): void {
  dropStaleAudio(ctx);
  renderChip(ctx);
}

function renderChip(ctx: VideoPanelContext): void {
  const { chip, chipName, chipMeta } = ctx.els;
  const chat = ctx.state.currentChat;
  const video = chat?.video;
  chip.hidden = !chat || !video;
  if (!chat || !video) return;
  const missing = isMissing(ctx);
  chip.classList.toggle("is-missing", missing);
  chipName.textContent = video.name;
  const overview = overviewText(overviewFor(ctx.state, chat.id));
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

function startOverview(ctx: VideoPanelContext, chatId: string): void {
  const toolCtx = toolContext(ctx.state, ctx.deps.store);
  if (!toolCtx) return;
  const key = toolCtx.video.fileKey;
  const stillAttached = () => attachedVideo(ctx, chatId)?.fileKey === key;
  const report = (status: OverviewStatus) => {
    if (!stillAttached()) return;
    setOverviewStatus(ctx.state, chatId, status);
    if (isCurrent(ctx, chatId)) renderChip(ctx);
    ctx.deps.onOverviewProgress();
  };
  const render = ctx.deps.renderOverview ?? renderOverview;
  report({ kind: "rendering", fileKey: key, done: 0, total: 0 });
  const done = render(toolCtx, (finished, total) => {
    report({ kind: "rendering", fileKey: key, done: finished, total });
  })
    .then((refs) => {
      if (!stillAttached()) return;
      report({ kind: "ready", fileKey: key, sheets: refs.length });
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
    isCurrent(ctx, prep.chatId) && attachedVideo(ctx, prep.chatId)?.fileKey === prep.fileKey;
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
