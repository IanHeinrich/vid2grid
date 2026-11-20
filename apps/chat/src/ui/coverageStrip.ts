import { seenSpans, type SeenSpan } from "../chat/coverage";
import { formatSpan, formatTimestamp } from "../time";
import type { ChatMessage } from "../types";

// Shade runs on a log scale: an overview's sparse frames are faint, a close look is solid.
const SPARSE_FPS = 0.02;
const DENSE_FPS = 4;
const FAINTEST_SHADE = 0.3;
const NOTHING_SEEN = "The model has not seen any of the video yet.";
const KEY_STEPS = 20;
const KEY_HELP = "Arrow keys pick a moment, Enter jumps the video there.";

export interface CoverageStrip {
  el: HTMLElement;
  update(messages: readonly ChatMessage[], durationSeconds: number | undefined): void;
  follow(video: HTMLVideoElement): void;
}

export interface CoverageStripDeps {
  onSeek(seconds: number): void;
}

interface StripContext {
  el: HTMLElement;
  track: HTMLElement;
  playhead: HTMLElement;
  cursor: HTMLElement;
  deps: CoverageStripDeps;
  durationSeconds: number | undefined;
  spans: SeenSpan[];
  playingSeconds: number;
  cursorSeconds: number;
  shown: string;
}

export function densityShade(framesPerSecond: number): number {
  const level =
    Math.log(Math.max(framesPerSecond, SPARSE_FPS) / SPARSE_FPS) / Math.log(DENSE_FPS / SPARSE_FPS);
  return FAINTEST_SHADE + (1 - FAINTEST_SHADE) * Math.min(1, level);
}

export function densityText(framesPerSecond: number): string {
  if (framesPerSecond >= 1) return `${Math.round(framesPerSecond * 10) / 10} frames a second`;
  return `a frame every ${Math.round(1 / framesPerSecond)} s`;
}

export function clippedSpans(spans: readonly SeenSpan[], durationSeconds: number): SeenSpan[] {
  return spans.flatMap((span) => {
    const startSeconds = Math.max(0, span.startSeconds);
    const endSeconds = Math.min(durationSeconds, span.endSeconds);
    return endSeconds > startSeconds ? [{ ...span, startSeconds, endSeconds }] : [];
  });
}

export function seenShare(spans: readonly SeenSpan[], durationSeconds: number): number {
  if (durationSeconds <= 0) return 0;
  const seen = clippedSpans(spans, durationSeconds).reduce(
    (total, span) => total + span.endSeconds - span.startSeconds,
    0,
  );
  return Math.min(1, seen / durationSeconds);
}

export function createCoverageStrip(deps: CoverageStripDeps): CoverageStrip {
  const el = document.createElement("div");
  el.className = "coverage-strip";
  el.hidden = true;
  const track = document.createElement("div");
  track.className = "coverage-track";
  track.tabIndex = 0;
  track.setAttribute("role", "slider");
  track.setAttribute("aria-valuemin", "0");
  track.setAttribute("aria-description", KEY_HELP);
  const playhead = document.createElement("span");
  playhead.className = "coverage-playhead";
  playhead.hidden = true;
  const cursor = document.createElement("span");
  cursor.className = "coverage-cursor";
  el.append(track);
  const ctx: StripContext = {
    el,
    track,
    playhead,
    cursor,
    deps,
    durationSeconds: undefined,
    spans: [],
    playingSeconds: 0,
    cursorSeconds: 0,
    shown: "",
  };
  track.addEventListener("click", (event) => seekAt(ctx, event));
  track.addEventListener("focus", () => setCursor(ctx, ctx.playingSeconds));
  track.addEventListener("keydown", (event) => onKey(ctx, event));
  return {
    el,
    update: (messages, durationSeconds) => update(ctx, messages, durationSeconds),
    follow: (video) => follow(ctx, video),
  };
}

function percent(seconds: number, durationSeconds: number): string {
  return `${(seconds / durationSeconds) * 100}%`;
}

function update(
  ctx: StripContext,
  messages: readonly ChatMessage[],
  durationSeconds: number | undefined,
): void {
  const usable = durationSeconds !== undefined && durationSeconds > 0 ? durationSeconds : undefined;
  const spans = usable === undefined ? [] : clippedSpans(seenSpans(messages), usable);
  const shown = JSON.stringify([usable, spans]);
  if (shown === ctx.shown) return;
  ctx.shown = shown;
  ctx.durationSeconds = usable;
  ctx.spans = spans;
  ctx.el.hidden = usable === undefined;
  if (usable === undefined) return;
  const share = Math.round(seenShare(spans, usable) * 100);
  const label = spans.length === 0 ? NOTHING_SEEN : `The model has seen ${share}% of the video.`;
  ctx.track.title = `${label} Click to jump there.`;
  ctx.track.setAttribute("aria-label", label);
  ctx.track.setAttribute("aria-valuemax", String(usable));
  ctx.track.replaceChildren(
    ...spans.map((span) => segment(span, usable)),
    ctx.playhead,
    ctx.cursor,
  );
  setCursor(ctx, ctx.cursorSeconds);
}

function setCursor(ctx: StripContext, seconds: number): void {
  const duration = ctx.durationSeconds;
  if (duration === undefined) return;
  const at = Math.min(duration, Math.max(0, seconds));
  ctx.cursorSeconds = at;
  const seen = ctx.spans.some((span) => at >= span.startSeconds && at <= span.endSeconds);
  ctx.cursor.style.left = percent(at, duration);
  ctx.track.setAttribute("aria-valuenow", String(at));
  ctx.track.setAttribute(
    "aria-valuetext",
    `${formatTimestamp(at)}, ${seen ? "seen" : "not seen yet"}`,
  );
}

function onKey(ctx: StripContext, event: KeyboardEvent): void {
  const duration = ctx.durationSeconds;
  if (duration === undefined) return;
  const step = duration / KEY_STEPS;
  const targets: Partial<Record<string, number>> = {
    ArrowLeft: ctx.cursorSeconds - step,
    ArrowDown: ctx.cursorSeconds - step,
    ArrowRight: ctx.cursorSeconds + step,
    ArrowUp: ctx.cursorSeconds + step,
    Home: 0,
    End: duration,
  };
  const target = targets[event.key];
  if (target !== undefined) {
    event.preventDefault();
    setCursor(ctx, target);
  } else if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    ctx.deps.onSeek(ctx.cursorSeconds);
  }
}

function segment(span: SeenSpan, durationSeconds: number): HTMLElement {
  const el = document.createElement("span");
  el.className = "coverage-segment";
  el.style.left = percent(span.startSeconds, durationSeconds);
  el.style.width = percent(span.endSeconds - span.startSeconds, durationSeconds);
  el.style.setProperty("--density", densityShade(span.framesPerSecond).toFixed(2));
  el.title = `Seen ${formatSpan(span.startSeconds, span.endSeconds)}, ${densityText(span.framesPerSecond)}`;
  return el;
}

function seekAt(ctx: StripContext, event: MouseEvent): void {
  const duration = ctx.durationSeconds;
  const rect = ctx.track.getBoundingClientRect();
  if (duration === undefined || rect.width <= 0) return;
  const share = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
  ctx.deps.onSeek(share * duration);
}

function follow(ctx: StripContext, video: HTMLVideoElement): void {
  const move = () => {
    const duration = ctx.durationSeconds;
    ctx.playhead.hidden = duration === undefined;
    if (duration === undefined) return;
    const seconds = Math.min(video.currentTime, duration);
    ctx.playingSeconds = seconds;
    ctx.playhead.style.left = percent(seconds, duration);
    ctx.playhead.title = `Playing at ${formatTimestamp(seconds)}`;
  };
  for (const type of ["timeupdate", "seeked", "loadedmetadata"]) {
    video.addEventListener(type, move);
  }
}
