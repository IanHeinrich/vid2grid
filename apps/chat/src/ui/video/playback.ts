import { readFrameTimes } from "@vid2grid/browser";
import { errorText } from "../../text";
import { wasRemoved } from "../../chat/messageVideo";
import { formatTimestamp } from "../../time";
import type { VideoAttachment } from "../../types";
import {
  currentPendingFile,
  currentShownVideo,
  isMissing,
  pendingUrlOf,
  showingPending,
  type OlderVideo,
  type VideoPanelContext,
} from "./context";
import { playQuietly } from "./miniPlayer";

// Read from the renderer's own File, so the two share one demux.
export function readFrameTimesOf(ctx: VideoPanelContext, file: File): void {
  if (ctx.frameTimes.has(file)) return;
  ctx.frameTimes.set(file, undefined);
  const read = ctx.deps.readFrameTimes ?? readFrameTimes;
  Promise.resolve()
    .then(() => read(file))
    .then((times) => ctx.frameTimes.set(file, times))
    .catch(() => undefined);
}

export function loadedFrameTimes(ctx: VideoPanelContext): number[] | undefined {
  const pending = currentPendingFile(ctx);
  if (pending) return ctx.frameTimes.get(pending.file);
  const loaded = ctx.state.video;
  if (!loaded || loaded.chatId !== ctx.state.currentChat?.id) return undefined;
  return ctx.frameTimes.get(loaded.file);
}

export function setUrl(ctx: VideoPanelContext, file: File | null): void {
  closePlayer(ctx);
  const player = ctx.els.miniPlayer.video;
  player.removeAttribute("src");
  ctx.player.reset();
  if (ctx.objectUrl) URL.revokeObjectURL(ctx.objectUrl);
  ctx.objectUrl = file ? URL.createObjectURL(file) : null;
}

// Keeps one object URL for the current chat's pending file, so its thumbnail and player share it.
export function syncPendingUrl(ctx: VideoPanelContext): void {
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

export function openPlayer(ctx: VideoPanelContext, seconds?: number, play = true): void {
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

export function openAtTimestamp(ctx: VideoPanelContext, seconds: number, play: boolean): void {
  openPlayer(ctx, seconds, play);
  if (!ctx.els.miniPlayer.el.hidden) ctx.player.offerLoopAround(seconds);
}

export function seekMoment(ctx: VideoPanelContext, seconds: number, video?: VideoAttachment): void {
  const { currentChat, messages } = ctx.state;
  const target = video ?? currentChat?.video;
  if (!target || target.fileKey === currentShownVideo(ctx)?.fileKey) {
    openAtTimestamp(ctx, seconds, true);
  } else if (currentChat && wasRemoved(currentChat, messages, target.fileKey)) {
    ctx.deps.status.show(
      `That moment is in ${target.name}, which was removed from this chat. Attach it again to jump there.`,
    );
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

export function closePlayer(ctx: VideoPanelContext): void {
  const { el: miniPlayer, video: miniPlayerVideo } = ctx.els.miniPlayer;
  releaseOlder(ctx);
  if (miniPlayer.hidden) return;
  miniPlayerVideo.pause();
  miniPlayer.hidden = true;
  ctx.player.reset();
}
