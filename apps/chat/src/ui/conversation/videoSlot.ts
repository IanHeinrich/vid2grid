import type { VideoAttachment } from "../../types";
import { smallButton } from "../buttons";
import { createCoverageStrip } from "../video/coverageStrip";
import { videoSummary } from "../video/overviewText";
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
    coverage: undefined,
  };
  slot.el.className = "inline-video";
  ctx.videoSlots.set(messageId, slot);
  renderVideoSlot(ctx, slot);
  return slot.el;
}

function videoCaption(text: string): HTMLElement {
  const caption = document.createElement("span");
  caption.className = "inline-video-caption";
  caption.textContent = text;
  return caption;
}

// Rebuilt only when what it shows changes, so a refresh does not stop an inline video mid-play.
export function renderVideoSlot(ctx: ConversationContext, slot: VideoSlot): void {
  const view = ctx.deps.videoView();
  const replaced = view.video?.fileKey !== slot.video.fileKey;
  const shown = replaced ? "replaced" : (view.url ?? "missing");
  if (shown === slot.shown) return;
  slot.shown = shown;
  slot.el.classList.toggle("is-replaced", replaced);
  slot.coverage = undefined;
  const summary = videoSummary(slot.video);
  if (replaced) {
    slot.el.replaceChildren(videoCaption(`${summary} (replaced)`));
    return;
  }
  if (view.url === null) {
    const reattach = smallButton("button primary", "Reattach video", () => ctx.deps.onReattach());
    slot.el.replaceChildren(videoCaption(summary), reattach);
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
  const bar = document.createElement("div");
  bar.className = "inline-video-bar";
  bar.append(videoCaption(summary), popOut);
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
