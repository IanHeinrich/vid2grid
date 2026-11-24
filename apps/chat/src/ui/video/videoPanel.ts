import type { AppElements } from "../../dom";
import { shownVideo, type AppState } from "../../state";
import { errorText } from "../../text";
import type { VideoAttachment } from "../../types";
import { dropStaleAudio } from "./audioPrep";
import {
  attach,
  commit,
  detach,
  dropStalePending,
  putBack,
  requestReattach,
  restore,
} from "./attachment";
import { renderChip } from "./chip";
import {
  committedLoaded,
  currentPendingFile,
  currentRender,
  isMissing,
  pendingUrlOf,
  showingPending,
  type LoadedFile,
  type VideoPanelContext,
  type VideoPanelDeps,
  type VideoView,
} from "./context";
import { createCoverageStrip } from "./coverageStrip";
import { initMiniPlayer, videoAspect } from "./miniPlayer";
import { startWaitingOverviews } from "./overviewPrep";
import {
  closePlayer,
  loadedFrameTimes,
  openAtTimestamp,
  openPlayer,
  seekMoment,
  syncPendingUrl,
} from "./playback";

export type { LoadedFile, VideoPanelDeps, VideoView } from "./context";

export interface VideoPanel {
  restore(): Promise<void>;
  // Adds the video to the message being written; the chat keeps its own video until it is sent.
  attach(file: File, handle?: FileSystemFileHandle): Promise<void>;
  // Makes the sent video the chat's own, saving it before anything in memory changes.
  commit(chatId: string, video: VideoAttachment): Promise<void>;
  reattach(): Promise<void>;
  // Stops playing and preparing videos the chat no longer names, and lets go of its own file.
  detach(chatId: string, keys: ReadonlySet<string>): LoadedFile | undefined;
  // Opens the chat's own video again after detach.
  putBack(chatId: string, loaded: LoadedFile | undefined): Promise<void>;
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
    render: () => render(ctx),
  };
  listen(ctx);
  render(ctx);
  els.miniPlayer.video.after(ctx.coverage.el);
  ctx.coverage.follow(els.miniPlayer.video);
  return {
    restore: () => restore(ctx),
    attach: (file, handle) => attach(ctx, file, handle),
    commit: (chatId, video) => commit(ctx, chatId, video),
    reattach: () => requestReattach(ctx),
    detach: (chatId, keys) => detach(ctx, chatId, keys),
    putBack: (chatId, loaded) => putBack(ctx, chatId, loaded),
    seek: (seconds, video) => seekMoment(ctx, seconds, video),
    cue: (seconds) => openAtTimestamp(ctx, seconds, false),
    openPlayer: (seconds) => openPlayer(ctx, seconds),
    attachedPlaybackTime: () =>
      playing.older || showingPending(ctx) ? undefined : els.miniPlayer.video.currentTime,
    view: () => committedView(ctx),
    pendingView: () => pendingView(ctx),
    render: () => render(ctx),
    renderCoverage: () =>
      ctx.coverage.update(state.messages, state.currentChat?.video?.durationSeconds),
    overviewRendering: () => currentRender(ctx) !== undefined,
    whenOverviewReady: () => currentRender(ctx)?.done ?? Promise.resolve(),
  };
}

function committedView(ctx: VideoPanelContext): VideoView {
  return {
    video: ctx.state.currentChat?.video,
    url: committedLoaded(ctx) ? ctx.objectUrl : null,
  };
}

function pendingView(ctx: VideoPanelContext): VideoView {
  const pending = currentPendingFile(ctx);
  return { video: pending?.video, url: pending ? pendingUrlOf(ctx, pending.file) : null };
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

function render(ctx: VideoPanelContext): void {
  dropStalePending(ctx);
  syncPendingUrl(ctx);
  startWaitingOverviews(ctx);
  dropStaleAudio(ctx);
  renderChip(ctx);
}
