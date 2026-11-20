import type { AppElements } from "../dom";
import { formatSpan } from "../time";

const STORAGE_KEY = "vid2grid-chat-mini-player";
const FALLBACK_FRAME_SECONDS = 1 / 30;
// Frame times are rounded to the microsecond, so a frame can start just after currentTime.
const FRAME_TIME_TOLERANCE = 1e-6;
const MEASURED_FRAMES_KEPT = 15;
const MIN_MEASURED_FRAMES = 3;
const FALLBACK_ASPECT = 16 / 9;
const LOOP_RADIUS_SECONDS = 2;
const MIN_LOOP_SECONDS = 0.1;
const MIN_WIDTH = 240;
const MAX_WIDTH = 960;
const EDGE_MARGIN = 8;
const RESIZE_KEY_STEP = 24;

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export type Rect = Point & Size;

export interface Placement extends Point {
  width: number;
}

export interface Layout {
  docked: boolean;
  placement?: Placement;
}

export interface Loop {
  start: number;
  end: number;
}

export interface PresentedFrame {
  mediaTime: number;
  presentedFrames: number;
}

export interface WidthLimits {
  aspect: number;
  chromeHeight: number;
  viewport: Size;
}

export interface MiniPlayerDeps {
  durationSeconds(): number;
  frameTimes(): readonly number[] | undefined;
  aspect(): number;
  storage?: Storage;
}

export interface MiniPlayer {
  layout(): void;
  offerLoopAround(seconds: number): void;
  reset(): void;
  dispose(): void;
}

type MiniPlayerElements = AppElements["video"];

interface MiniPlayerContext {
  els: MiniPlayerElements;
  deps: MiniPlayerDeps;
  storage: Storage;
  layout: Layout;
  loop: Loop | null;
  loopIsAround: boolean;
  aroundSeconds: number | null;
  hovered: boolean;
  loopFrame: number | null;
  watchingFrames: boolean;
  lastPresented: PresentedFrame | null;
  frameDurations: number[];
  signal: AbortSignal;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function clampPosition(rect: Rect, viewport: Size, margin = EDGE_MARGIN): Point {
  const maxX = Math.max(margin, viewport.width - rect.width - margin);
  const maxY = Math.max(margin, viewport.height - rect.height - margin);
  return { x: clamp(rect.x, margin, maxX), y: clamp(rect.y, margin, maxY) };
}

export function clampWidth(width: number, limits: WidthLimits): number {
  const { aspect, chromeHeight, viewport } = limits;
  const byWidth = Math.min(MAX_WIDTH, viewport.width - 2 * EDGE_MARGIN);
  const byHeight = (viewport.height - 2 * EDGE_MARGIN - chromeHeight) * aspect;
  return clamp(width, MIN_WIDTH, Math.max(MIN_WIDTH, Math.min(byWidth, byHeight)));
}

// The handle sits top left, so the bottom-right corner stays put while the player grows.
export function resizeFromTopLeft(start: Rect, delta: Point, limits: WidthLimits): Rect {
  const dy = delta.y * limits.aspect;
  const shrinkBy = Math.abs(delta.x) >= Math.abs(dy) ? delta.x : dy;
  const width = clampWidth(start.width - shrinkBy, limits);
  const height = limits.chromeHeight + width / limits.aspect;
  const anchored = {
    x: start.x + start.width - width,
    y: start.y + start.height - height,
    width,
    height,
  };
  return { ...anchored, ...clampPosition(anchored, limits.viewport) };
}

export function videoAspect(size: Size | undefined): number {
  return size && size.width > 0 && size.height > 0 ? size.width / size.height : FALLBACK_ASPECT;
}

export function frameStepSeconds(measured: number | undefined): number {
  return measured !== undefined && Number.isFinite(measured) && measured > 0
    ? measured
    : FALLBACK_FRAME_SECONDS;
}

// Frames skipped between callbacks, or a seek, would make the gap more than one frame long.
export function presentedFrameDuration(
  previous: PresentedFrame,
  next: PresentedFrame,
): number | undefined {
  const duration = next.mediaTime - previous.mediaTime;
  return next.presentedFrames - previous.presentedFrames === 1 && duration > 0
    ? duration
    : undefined;
}

export function medianFrameDuration(durations: readonly number[]): number | undefined {
  if (durations.length < MIN_MEASURED_FRAMES) return undefined;
  const sorted = [...durations].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle];
  const lower = sorted.length % 2 === 0 ? sorted[middle - 1] : upper;
  return upper === undefined || lower === undefined ? undefined : (lower + upper) / 2;
}

export function frameIndexAt(frameTimes: readonly number[], time: number): number {
  let low = 0;
  let high = frameTimes.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if ((frameTimes[middle] ?? Infinity) <= time + FRAME_TIME_TOLERANCE) low = middle;
    else high = middle - 1;
  }
  return low;
}

// Lands midway into the frame, as steppedTime does, for the same reason.
export function steppedFrameTime(
  frameTimes: readonly number[],
  current: number,
  direction: -1 | 1,
  duration: number,
): number | undefined {
  const target = clamp(frameIndexAt(frameTimes, current) + direction, 0, frameTimes.length - 1);
  const start = frameTimes[target];
  if (start === undefined) return undefined;
  const end = frameTimes[target + 1] ?? Math.max(start, duration);
  return (start + end) / 2;
}

// Lands mid-frame, so rounding in currentTime cannot leave the same frame on screen.
export function steppedTime(
  current: number,
  direction: -1 | 1,
  step: number,
  duration: number,
): number {
  const frame = Math.floor(current / step + 1e-6);
  return clamp((frame + direction + 0.5) * step, 0, duration);
}

export function loopAround(seconds: number, duration: number): Loop {
  return {
    start: clamp(seconds - LOOP_RADIUS_SECONDS, 0, duration),
    end: clamp(seconds + LOOP_RADIUS_SECONDS, 0, duration),
  };
}

export function withLoopPoint(
  loop: Loop | null,
  point: "in" | "out",
  seconds: number,
  duration: number,
): Loop | null {
  const at = clamp(seconds, 0, duration);
  const next =
    point === "in"
      ? { start: at, end: loop && loop.end > at ? loop.end : duration }
      : { start: loop && loop.start < at ? loop.start : 0, end: at };
  return next.end - next.start >= MIN_LOOP_SECONDS ? next : null;
}

export function loopRestart(time: number, loop: Loop | null): number | undefined {
  return loop && time >= loop.end ? loop.start : undefined;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function placementFrom(value: unknown): Placement | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const { x, y, width } = value as Record<string, unknown>;
  return isFiniteNumber(x) && isFiniteNumber(y) && isFiniteNumber(width) && width > 0
    ? { x, y, width }
    : undefined;
}

export function parseLayout(raw: string | null): Layout {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw ?? "{}");
  } catch {
    return { docked: false };
  }
  if (typeof parsed !== "object" || parsed === null) return { docked: false };
  const { docked, placement } = parsed as Record<string, unknown>;
  const placed = placementFrom(placement);
  return { docked: docked === true, ...(placed && { placement: placed }) };
}

// Some browsers return no promise from play(), and autoplay may be refused; neither matters here.
export function playQuietly(video: HTMLVideoElement): void {
  Promise.resolve()
    .then(() => video.play())
    .catch(() => undefined);
}

export function initMiniPlayer(els: MiniPlayerElements, deps: MiniPlayerDeps): MiniPlayer {
  const listening = new AbortController();
  const storage = deps.storage ?? localStorage;
  const ctx: MiniPlayerContext = {
    els,
    deps,
    storage,
    layout: parseLayout(storage.getItem(STORAGE_KEY)),
    loop: null,
    loopIsAround: false,
    aroundSeconds: null,
    hovered: false,
    loopFrame: null,
    watchingFrames: false,
    lastPresented: null,
    frameDurations: [],
    signal: listening.signal,
  };
  listen(ctx);
  applyLayout(ctx);
  renderLoop(ctx);
  return {
    layout: () => applyLayout(ctx),
    offerLoopAround: (seconds) => offerLoopAround(ctx, seconds),
    reset: () => {
      ctx.aroundSeconds = null;
      setLoop(ctx, null);
    },
    dispose: () => listening.abort(),
  };
}

function listen(ctx: MiniPlayerContext): void {
  const { signal } = ctx;
  const els = ctx.els;
  const video = els.miniPlayerVideo;
  els.miniPlayerBar.addEventListener("pointerdown", (event) => startDrag(ctx, event), { signal });
  els.miniPlayerResize.addEventListener("pointerdown", (event) => startResize(ctx, event), {
    signal,
  });
  els.miniPlayerResize.addEventListener("keydown", (event) => resizeByKey(ctx, event), { signal });
  els.miniPlayerDock.addEventListener("click", () => setDocked(ctx, !ctx.layout.docked), {
    signal,
  });
  els.miniPlayerStepBack.addEventListener("click", () => step(ctx, -1), { signal });
  els.miniPlayerStepForward.addEventListener("click", () => step(ctx, 1), { signal });
  els.miniPlayerSpeed.addEventListener("change", () => setSpeed(ctx), { signal });
  els.miniPlayerLoopAround.addEventListener("click", () => toggleLoopAround(ctx), { signal });
  els.miniPlayerLoopIn.addEventListener("click", () => setLoopPoint(ctx, "in"), { signal });
  els.miniPlayerLoopOut.addEventListener("click", () => setLoopPoint(ctx, "out"), { signal });
  els.miniPlayerLoopClear.addEventListener("click", () => setLoop(ctx, null), { signal });
  els.miniPlayer.addEventListener("pointerenter", () => (ctx.hovered = true), { signal });
  els.miniPlayer.addEventListener("pointerleave", () => (ctx.hovered = false), { signal });
  video.addEventListener("timeupdate", () => enforceLoop(ctx), { signal });
  video.addEventListener(
    "play",
    () => {
      watchLoop(ctx);
      watchFrames(ctx);
    },
    { signal },
  );
  video.addEventListener("loadstart", () => forgetFrames(ctx), { signal });
  video.addEventListener(
    "ended",
    () => {
      if (!ctx.loop) return;
      video.currentTime = ctx.loop.start;
      playQuietly(video);
    },
    { signal },
  );
  document.addEventListener("keydown", (event) => onKey(ctx, event), { signal });
  window.addEventListener("resize", () => applyLayout(ctx), { signal });
}

function viewport(): Size {
  return { width: window.innerWidth, height: window.innerHeight };
}

function currentRect(ctx: MiniPlayerContext): Rect {
  const box = ctx.els.miniPlayer.getBoundingClientRect();
  return { x: box.left, y: box.top, width: box.width, height: box.height };
}

function widthLimits(ctx: MiniPlayerContext): WidthLimits {
  const playerHeight = ctx.els.miniPlayer.getBoundingClientRect().height;
  const videoHeight = ctx.els.miniPlayerVideo.getBoundingClientRect().height;
  return {
    aspect: ctx.deps.aspect(),
    chromeHeight: Math.max(0, playerHeight - videoHeight),
    viewport: viewport(),
  };
}

function saveLayout(ctx: MiniPlayerContext): void {
  ctx.storage.setItem(STORAGE_KEY, JSON.stringify(ctx.layout));
}

function applyLayout(ctx: MiniPlayerContext): void {
  const { miniPlayer, miniPlayerDock, miniPlayerResize, miniPlayerVideo } = ctx.els;
  const { docked, placement } = ctx.layout;
  miniPlayerVideo.style.aspectRatio = String(ctx.deps.aspect());
  miniPlayer.classList.toggle("is-docked", docked);
  miniPlayer.classList.toggle("is-placed", !docked && placement !== undefined);
  miniPlayerDock.setAttribute("aria-pressed", String(docked));
  miniPlayerResize.hidden = docked;
  if (docked || !placement) {
    miniPlayer.style.removeProperty("left");
    miniPlayer.style.removeProperty("top");
    miniPlayer.style.removeProperty("width");
    return;
  }
  // The saved placement is left alone, so a window shrunk for a moment does not move it for good.
  const limits = widthLimits(ctx);
  const width = clampWidth(placement.width, limits);
  const height = limits.chromeHeight + width / limits.aspect;
  showAt(ctx, { ...clampPosition({ ...placement, width, height }, limits.viewport), width });
}

function showAt(ctx: MiniPlayerContext, placement: Placement): void {
  const style = ctx.els.miniPlayer.style;
  style.left = `${Math.round(placement.x)}px`;
  style.top = `${Math.round(placement.y)}px`;
  style.width = `${Math.round(placement.width)}px`;
}

function place(ctx: MiniPlayerContext, { x, y, width }: Placement): void {
  const placement = { x, y, width };
  ctx.layout = { ...ctx.layout, placement };
  ctx.els.miniPlayer.classList.add("is-placed");
  showAt(ctx, placement);
}

function setDocked(ctx: MiniPlayerContext, docked: boolean): void {
  ctx.layout = { ...ctx.layout, docked };
  saveLayout(ctx);
  applyLayout(ctx);
}

function trackPointer(
  ctx: MiniPlayerContext,
  event: MouseEvent,
  onMove: (delta: Point) => void,
): void {
  event.preventDefault();
  const origin = { x: event.clientX, y: event.clientY };
  const dragging = new AbortController();
  const options = { signal: dragging.signal };
  const finish = () => {
    dragging.abort();
    saveLayout(ctx);
  };
  window.addEventListener(
    "pointermove",
    (move: MouseEvent) => onMove({ x: move.clientX - origin.x, y: move.clientY - origin.y }),
    options,
  );
  window.addEventListener("pointerup", finish, options);
  window.addEventListener("pointercancel", finish, options);
}

function startDrag(ctx: MiniPlayerContext, event: MouseEvent): void {
  const onControl = event.target instanceof Element && event.target.closest("button") !== null;
  if (ctx.layout.docked || event.button !== 0 || onControl) return;
  const start = currentRect(ctx);
  trackPointer(ctx, event, (delta) => {
    const moved = { ...start, x: start.x + delta.x, y: start.y + delta.y };
    place(ctx, { ...clampPosition(moved, viewport()), width: start.width });
  });
}

function startResize(ctx: MiniPlayerContext, event: MouseEvent): void {
  if (ctx.layout.docked || event.button !== 0) return;
  const start = currentRect(ctx);
  const limits = widthLimits(ctx);
  trackPointer(ctx, event, (delta) => place(ctx, resizeFromTopLeft(start, delta, limits)));
}

function resizeByKey(ctx: MiniPlayerContext, event: KeyboardEvent): void {
  const grow = event.key === "ArrowLeft" || event.key === "ArrowUp";
  const shrink = event.key === "ArrowRight" || event.key === "ArrowDown";
  if (ctx.layout.docked || (!grow && !shrink)) return;
  event.preventDefault();
  const shift = grow ? -RESIZE_KEY_STEP : RESIZE_KEY_STEP;
  place(ctx, resizeFromTopLeft(currentRect(ctx), { x: shift, y: 0 }, widthLimits(ctx)));
  saveLayout(ctx);
}

function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || target.matches("input, textarea, select"))
  );
}

function onKey(ctx: MiniPlayerContext, event: KeyboardEvent): void {
  if (event.key !== "," && event.key !== ".") return;
  if (event.ctrlKey || event.metaKey || event.altKey || ctx.els.miniPlayer.hidden) return;
  const target = event.target;
  const inside = target instanceof Node && ctx.els.miniPlayer.contains(target);
  if (!inside && (!ctx.hovered || isTyping(target))) return;
  event.preventDefault();
  step(ctx, event.key === "," ? -1 : 1);
}

function step(ctx: MiniPlayerContext, direction: -1 | 1): void {
  const video = ctx.els.miniPlayerVideo;
  video.pause();
  const current = video.currentTime;
  const duration = ctx.deps.durationSeconds();
  const byFrameTimes = steppedFrameTime(ctx.deps.frameTimes() ?? [], current, direction, duration);
  const measured = frameStepSeconds(medianFrameDuration(ctx.frameDurations));
  video.currentTime = byFrameTimes ?? steppedTime(current, direction, measured, duration);
}

function forgetFrames(ctx: MiniPlayerContext): void {
  ctx.lastPresented = null;
  ctx.frameDurations = [];
}

// For files without demuxed frame times, the presented frames show how long a frame lasts.
function watchFrames(ctx: MiniPlayerContext): void {
  const video = ctx.els.miniPlayerVideo;
  ctx.lastPresented = null;
  if (ctx.watchingFrames || !("requestVideoFrameCallback" in video)) return;
  ctx.watchingFrames = true;
  const onFrame = (_now: number, metadata: VideoFrameCallbackMetadata) => {
    const presented = { mediaTime: metadata.mediaTime, presentedFrames: metadata.presentedFrames };
    const duration = ctx.lastPresented && presentedFrameDuration(ctx.lastPresented, presented);
    if (duration) {
      ctx.frameDurations = [...ctx.frameDurations, duration].slice(-MEASURED_FRAMES_KEPT);
    }
    ctx.lastPresented = presented;
    if (video.paused || ctx.signal.aborted) ctx.watchingFrames = false;
    else video.requestVideoFrameCallback(onFrame);
  };
  video.requestVideoFrameCallback(onFrame);
}

function setSpeed(ctx: MiniPlayerContext): void {
  const rate = Number(ctx.els.miniPlayerSpeed.value);
  if (!(rate > 0)) return;
  const video = ctx.els.miniPlayerVideo;
  // A new src resets playbackRate to the default, so both are set.
  video.defaultPlaybackRate = rate;
  video.playbackRate = rate;
}

function offerLoopAround(ctx: MiniPlayerContext, seconds: number): void {
  const loop = ctx.loop;
  const outside = loop !== null && (seconds < loop.start || seconds >= loop.end);
  ctx.aroundSeconds = seconds;
  if (ctx.loopIsAround || outside) setLoop(ctx, null);
  else renderLoop(ctx);
}

function toggleLoopAround(ctx: MiniPlayerContext): void {
  if (ctx.aroundSeconds === null) return;
  if (ctx.loop && ctx.loopIsAround) setLoop(ctx, null);
  else setLoop(ctx, loopAround(ctx.aroundSeconds, ctx.deps.durationSeconds()), true);
}

function setLoopPoint(ctx: MiniPlayerContext, point: "in" | "out"): void {
  const time = ctx.els.miniPlayerVideo.currentTime;
  const next = withLoopPoint(ctx.loop, point, time, ctx.deps.durationSeconds());
  if (next) setLoop(ctx, next);
}

function setLoop(ctx: MiniPlayerContext, loop: Loop | null, around = false): void {
  ctx.loop = loop;
  ctx.loopIsAround = loop !== null && around;
  const video = ctx.els.miniPlayerVideo;
  if (loop && (video.currentTime < loop.start || video.currentTime >= loop.end)) {
    video.currentTime = loop.start;
  }
  renderLoop(ctx);
  watchLoop(ctx);
}

function enforceLoop(ctx: MiniPlayerContext): void {
  const video = ctx.els.miniPlayerVideo;
  const restart = loopRestart(video.currentTime, ctx.loop);
  if (restart !== undefined) video.currentTime = restart;
}

// timeupdate fires only a few times a second, too coarse for a four-second loop.
function watchLoop(ctx: MiniPlayerContext): void {
  if (ctx.loopFrame !== null) return;
  const tick = () => {
    if (!ctx.loop || ctx.els.miniPlayerVideo.paused || ctx.signal.aborted) {
      ctx.loopFrame = null;
      return;
    }
    enforceLoop(ctx);
    ctx.loopFrame = requestAnimationFrame(tick);
  };
  if (ctx.loop && !ctx.els.miniPlayerVideo.paused) ctx.loopFrame = requestAnimationFrame(tick);
}

function renderLoop(ctx: MiniPlayerContext): void {
  const els = ctx.els;
  const { loop, aroundSeconds } = ctx;
  const duration = ctx.deps.durationSeconds();
  els.miniPlayerLoopAround.hidden = aroundSeconds === null;
  els.miniPlayerLoopAround.setAttribute("aria-pressed", String(ctx.loopIsAround));
  if (aroundSeconds !== null) {
    const range = loopAround(aroundSeconds, duration);
    els.miniPlayerLoopAround.title = `Loop ${formatSpan(range.start, range.end)} until turned off`;
  }
  els.miniPlayerLoopRange.hidden = loop === null;
  els.miniPlayerLoopClear.hidden = loop === null;
  els.miniPlayerLoopTrack.hidden = loop === null;
  if (!loop) return;
  const span = formatSpan(loop.start, loop.end);
  els.miniPlayerLoopRange.textContent = span;
  els.miniPlayerLoopTrack.title = `Looping ${span}`;
  const percent = (seconds: number) => `${duration > 0 ? (seconds / duration) * 100 : 0}%`;
  els.miniPlayerLoopBand.style.left = percent(loop.start);
  els.miniPlayerLoopBand.style.width = percent(loop.end - loop.start);
}
