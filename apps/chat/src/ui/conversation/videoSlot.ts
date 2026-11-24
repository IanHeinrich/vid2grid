import type { VideoAttachment } from "../../types";
import { smallButton } from "../shared/buttons";
import { createCoverageStrip } from "../video/coverageStrip";
import { removeVideoTitle, videoSummary } from "../video/overviewText";
import type { ConversationContext, VideoSlot } from "./context";

export function aspectOf(video: VideoAttachment | undefined): number | undefined {
  return video && video.width > 0 && video.height > 0 ? video.width / video.height : undefined;
}

export function videoSlotFor(
  ctx: ConversationContext,
  messageId: string,
  video: VideoAttachment,
): HTMLElement {
  const slot: VideoSlot = {
    el: document.createElement("div"),
    video,
    shown: "",
    remove: smallButton("remove-video", "Remove from chat", () => {
      ctx.pendingFocus = { kind: "message", id: messageId };
      ctx.deps.onRemoveVideo(video);
    }),
    coverage: undefined,
  };
  slot.el.className = "inline-video";
  ctx.videoSlots.set(messageId, slot);
  renderVideoSlot(ctx, slot);
  return slot.el;
}

export function removedVideoLine(video: VideoAttachment): HTMLElement {
  const el = document.createElement("div");
  el.className = "inline-video is-removed";
  el.append(videoCaption(`${video.name}, removed from this chat`));
  return el;
}

export function renderRemove(ctx: ConversationContext, { remove, video }: VideoSlot): void {
  const reason = ctx.deps.removeBlocker();
  remove.disabled = reason !== undefined;
  remove.title = reason ?? removeVideoTitle(video);
}

function slotBar(...parts: HTMLElement[]): HTMLElement {
  const bar = document.createElement("div");
  bar.className = "inline-video-bar";
  bar.append(...parts);
  return bar;
}

function videoCaption(text: string): HTMLElement {
  const caption = document.createElement("span");
  caption.className = "inline-video-caption";
  caption.textContent = text;
  return caption;
}

// Rebuilt only when what it shows changes, so a refresh does not stop an inline video mid-play.
export function renderVideoSlot(ctx: ConversationContext, slot: VideoSlot): void {
  renderRemove(ctx, slot);
  const view = ctx.deps.videoView();
  const replaced = view.video?.fileKey !== slot.video.fileKey;
  const shown = replaced ? "replaced" : (view.url ?? "missing");
  if (shown === slot.shown) return;
  slot.shown = shown;
  slot.el.classList.toggle("is-replaced", replaced);
  slot.coverage = undefined;
  const summary = videoSummary(slot.video);
  if (replaced) {
    slot.el.replaceChildren(slotBar(videoCaption(`${summary} (replaced)`), slot.remove));
    return;
  }
  if (view.url === null) {
    const reattach = smallButton("button primary", "Reattach video", () => ctx.deps.onReattach());
    slot.el.replaceChildren(videoCaption(summary), slotBar(reattach, slot.remove));
    return;
  }
  const player = document.createElement("video");
  player.className = "inline-video-player";
  player.controls = true;
  player.preload = "metadata";
  player.playsInline = true;
  player.src = view.url;
  const popOut = smallButton("pop-out", "Pop out", () => {
    player.pause();
    ctx.deps.onPopOut(player.currentTime);
  });
  const bar = slotBar(videoCaption(summary), popOut, slot.remove);
  const coverage = createCoverageStrip({
    onSeek: (seconds) => {
      player.currentTime = seconds;
    },
  });
  coverage.follow(player);
  coverage.update([...ctx.messages.values()], slot.video.durationSeconds);
  slot.coverage = coverage;
  slot.el.replaceChildren(player, coverage.el, bar);
}
