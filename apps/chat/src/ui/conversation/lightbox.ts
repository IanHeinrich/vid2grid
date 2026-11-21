import { computeOptimalGrid, GUTTER_PX, type GridLayout } from "@vid2grid/core";
import type { AppElements } from "../../dom";
import { formatTimestamp } from "../../time";
import type { ImageRef, ImageStore } from "../../types";
import { imageCaption, sheetCellTimes } from "./captions";
import { setPinState } from "../buttons";

const MAX_ZOOM = 6;
const ZOOM_STEP = 1.25;
const DOUBLE_CLICK_ZOOM = 2.5;
const DRAG_THRESHOLD_PX = 4;
const DOUBLE_CLICK_MS = 250;
const CELL_HINT = "Click a frame to jump the video there";

export interface LightboxItem {
  messageId: string;
  index: number;
  ref: ImageRef;
  pinnable: boolean;
}

export interface Lightbox {
  open(items: LightboxItem[], position: number): void;
  close(): void;
}

export interface LightboxDeps {
  store: ImageStore;
  // Pins or unpins the item and returns the refreshed list of items.
  onTogglePin(item: LightboxItem): LightboxItem[];
  // Each takes the item shown, whose sheet may come from an earlier video of the chat.
  onSeek(seconds: number, item: LightboxItem): void;
  onAsk(seconds: number, item: LightboxItem): void;
  // Width over height of the video's frames, which a square sheet does not reveal by itself.
  sourceAspect(item: LightboxItem): number | undefined;
}

interface Zoom {
  scale: number;
  x: number;
  y: number;
}

interface Drag {
  pointerId: number;
  startX: number;
  startY: number;
  from: Zoom;
  moved: boolean;
}

interface LightboxContext {
  els: AppElements["lightbox"];
  deps: LightboxDeps;
  items: LightboxItem[];
  position: number;
  url: string | null;
  token: number;
  zoom: Zoom;
  drag: Drag | null;
  dragged: boolean;
  chosenSeconds: number | null;
  pendingSeek: ReturnType<typeof setTimeout> | null;
}

export type CellGrid = GridLayout;

// Sheets are square, so an image of any other shape is not one core laid out.
export function sheetGrid(
  frameCount: number,
  aspect: number,
  width: number,
  height: number,
): CellGrid | undefined {
  if (width !== height) return undefined;
  try {
    return computeOptimalGrid(frameCount, {
      sourceAspect: aspect,
      outputResolution: width,
      gutterPx: GUTTER_PX,
    });
  } catch {
    return undefined;
  }
}

function axisCell(position: number, offset: number, cell: number, count: number): number | null {
  const span = count * cell + (count + 1) * GUTTER_PX;
  if (position < offset || position > offset + span) return null;
  const index = Math.floor((position - offset - GUTTER_PX / 2) / (cell + GUTTER_PX));
  return Math.min(count - 1, Math.max(0, index));
}

export function cellAt(grid: CellGrid, x: number, y: number, frameCount: number): number | null {
  const col = axisCell(x, grid.offsetX, grid.cellW, grid.cols);
  const row = axisCell(y, grid.offsetY, grid.cellH, grid.rows);
  if (col === null || row === null) return null;
  const index = row * grid.cols + col;
  return index < frameCount ? index : null;
}

export function initLightbox(els: Pick<AppElements, "lightbox">, deps: LightboxDeps): Lightbox {
  const ctx: LightboxContext = {
    els: els.lightbox,
    deps,
    items: [],
    position: 0,
    url: null,
    token: 0,
    zoom: { scale: 1, x: 0, y: 0 },
    drag: null,
    dragged: false,
    chosenSeconds: null,
    pendingSeek: null,
  };
  listen(ctx);
  listenToZoom(ctx);
  return {
    open: (items, position) => {
      if (!items[position]) return;
      ctx.items = items;
      ctx.position = position;
      show(ctx);
      if (!ctx.els.dialog.open) ctx.els.dialog.showModal();
    },
    close: () => close(ctx),
  };
}

const ZOOM_KEYS: Record<string, number> = { "+": ZOOM_STEP, "=": ZOOM_STEP, "-": 1 / ZOOM_STEP };

function listen(ctx: LightboxContext): void {
  const { dialog, prev, next, close: closeButton, pin } = ctx.els;
  prev.addEventListener("click", () => move(ctx, -1));
  next.addEventListener("click", () => move(ctx, 1));
  closeButton.addEventListener("click", () => close(ctx));
  pin.addEventListener("click", () => togglePin(ctx));
  ctx.els.ask.addEventListener("click", () => ask(ctx));
  // A pan that ends over the backdrop is not a click on it.
  dialog.addEventListener("click", (event) => {
    if (ctx.dragged) ctx.dragged = false;
    else if (event.target === dialog) close(ctx);
  });
  dialog.addEventListener("close", () => releaseImage(ctx));
  dialog.addEventListener("keydown", (event) => {
    const moves: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1 };
    const delta = moves[event.key];
    const zoomFactor = ZOOM_KEYS[event.key];
    if (delta !== undefined) {
      event.preventDefault();
      move(ctx, delta);
    } else if (zoomFactor !== undefined) {
      event.preventDefault();
      zoomBy(ctx, zoomFactor);
    } else if (event.key === "Escape") {
      event.preventDefault();
      close(ctx);
    }
  });
}

function listenToZoom(ctx: LightboxContext): void {
  const { image, stage, zoomIn, zoomOut } = ctx.els;
  zoomIn.addEventListener("click", () => zoomBy(ctx, ZOOM_STEP));
  zoomOut.addEventListener("click", () => zoomBy(ctx, 1 / ZOOM_STEP));
  stage.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      zoomBy(ctx, event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP, event);
    },
    { passive: false },
  );
  image.addEventListener("dblclick", (event) => {
    event.preventDefault();
    cancelPendingSeek(ctx);
    const target = ctx.zoom.scale > 1 ? 1 : DOUBLE_CLICK_ZOOM;
    zoomBy(ctx, target / ctx.zoom.scale, event);
  });
  image.addEventListener("click", (event) => {
    if (ctx.dragged) {
      ctx.dragged = false;
      return;
    }
    if (event.detail <= 1) chooseCell(ctx, event);
  });
  image.addEventListener("pointerdown", (event) => startDrag(ctx, event));
  image.addEventListener("pointermove", (event) => moveDrag(ctx, event));
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
    image.addEventListener(type, () => endDrag(ctx));
  }
}

function startDrag(ctx: LightboxContext, event: PointerEvent): void {
  if (ctx.zoom.scale <= 1 || event.button !== 0) return;
  ctx.drag = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    from: { ...ctx.zoom },
    moved: false,
  };
  ctx.els.image.setPointerCapture(event.pointerId);
}

function moveDrag(ctx: LightboxContext, event: PointerEvent): void {
  const { drag } = ctx;
  if (drag?.pointerId !== event.pointerId) return;
  const dx = event.clientX - drag.startX;
  const dy = event.clientY - drag.startY;
  if (Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) drag.moved = true;
  setZoom(ctx, { scale: drag.from.scale, x: drag.from.x + dx, y: drag.from.y + dy });
}

function endDrag(ctx: LightboxContext): void {
  if (!ctx.drag) return;
  ctx.dragged = ctx.drag.moved;
  ctx.drag = null;
}

// Zooms about the pointer when there is one, so the spot under it stays put.
function zoomBy(ctx: LightboxContext, factor: number, at?: MouseEvent): void {
  const { scale, x, y } = ctx.zoom;
  const next = Math.min(MAX_ZOOM, Math.max(1, scale * factor));
  let offsetX = 0;
  let offsetY = 0;
  if (at) {
    const rect = ctx.els.image.getBoundingClientRect();
    offsetX = (at.clientX - (rect.left + rect.width / 2)) / scale;
    offsetY = (at.clientY - (rect.top + rect.height / 2)) / scale;
  }
  setZoom(ctx, { scale: next, x: x + offsetX * (scale - next), y: y + offsetY * (scale - next) });
}

function setZoom(ctx: LightboxContext, zoom: Zoom): void {
  const { image } = ctx.els;
  const limitX = ((zoom.scale - 1) * image.offsetWidth) / 2;
  const limitY = ((zoom.scale - 1) * image.offsetHeight) / 2;
  ctx.zoom = {
    scale: zoom.scale,
    x: Math.min(limitX, Math.max(-limitX, zoom.x)),
    y: Math.min(limitY, Math.max(-limitY, zoom.y)),
  };
  const zoomed = ctx.zoom.scale > 1;
  image.style.transform = zoomed
    ? `translate(${ctx.zoom.x}px, ${ctx.zoom.y}px) scale(${ctx.zoom.scale})`
    : "";
  image.classList.toggle("is-zoomed", zoomed);
  ctx.els.zoomOut.disabled = !zoomed;
  ctx.els.zoomIn.disabled = ctx.zoom.scale >= MAX_ZOOM;
}

function cellTimeAt(ctx: LightboxContext, event: MouseEvent): number | undefined {
  const item = ctx.items[ctx.position];
  const source = item?.ref.source;
  const aspect = item && ctx.deps.sourceAspect(item);
  const { image } = ctx.els;
  const rect = image.getBoundingClientRect();
  if (source?.kind !== "sheet" || aspect === undefined || rect.width <= 0 || rect.height <= 0) {
    return undefined;
  }
  const width = image.naturalWidth;
  const height = image.naturalHeight;
  const grid = sheetGrid(source.frameCount, aspect, width, height);
  if (!grid) return undefined;
  const x = ((event.clientX - rect.left) / rect.width) * width;
  const y = ((event.clientY - rect.top) / rect.height) * height;
  const index = cellAt(grid, x, y, source.frameCount);
  return index === null ? undefined : sheetCellTimes(source)[index];
}

// Waits out a possible second click, so a double-click zooms without seeking.
function chooseCell(ctx: LightboxContext, event: MouseEvent): void {
  const seconds = cellTimeAt(ctx, event);
  const item = ctx.items[ctx.position];
  if (seconds === undefined || !item) return;
  cancelPendingSeek(ctx);
  ctx.chosenSeconds = seconds;
  ctx.pendingSeek = setTimeout(() => {
    ctx.pendingSeek = null;
    ctx.els.hint.textContent = `Video at ${formatTimestamp(seconds, seconds % 1 !== 0)}`;
    ctx.deps.onSeek(seconds, item);
  }, DOUBLE_CLICK_MS);
}

function cancelPendingSeek(ctx: LightboxContext): void {
  if (ctx.pendingSeek !== null) clearTimeout(ctx.pendingSeek);
  ctx.pendingSeek = null;
}

function ask(ctx: LightboxContext): void {
  const item = ctx.items[ctx.position];
  const source = item?.ref.source;
  if (!item || source?.kind !== "sheet") return;
  ctx.deps.onAsk(ctx.chosenSeconds ?? source.startSeconds, item);
  close(ctx);
}

function move(ctx: LightboxContext, delta: number): void {
  const position = ctx.position + delta;
  if (position < 0 || position >= ctx.items.length) return;
  ctx.position = position;
  show(ctx);
}

function show(ctx: LightboxContext): void {
  const item = ctx.items[ctx.position];
  if (!item) return;
  const { els } = ctx;
  const { ref } = item;
  const isSheet = ref.source.kind === "sheet";
  els.label.textContent = imageCaption(ref);
  els.image.alt = imageCaption(ref);
  els.counter.textContent = `${ctx.position + 1} of ${ctx.items.length}`;
  els.prev.disabled = ctx.position === 0;
  els.next.disabled = ctx.position === ctx.items.length - 1;
  els.pin.hidden = !item.pinnable;
  setPinState(els.pin, ref.pinned);
  cancelPendingSeek(ctx);
  ctx.chosenSeconds = null;
  els.ask.hidden = !isSheet;
  els.hint.textContent = isSheet && ctx.deps.sourceAspect(item) !== undefined ? CELL_HINT : "";
  els.image.classList.toggle("is-seekable", isSheet);
  setZoom(ctx, { scale: 1, x: 0, y: 0 });
  loadImage(ctx, ref.id);
}

function loadImage(ctx: LightboxContext, imageId: string): void {
  releaseImage(ctx);
  const token = ++ctx.token;
  ctx.deps.store
    .getImage(imageId)
    .then((blob) => {
      if (blob === undefined || token !== ctx.token) return;
      ctx.url = URL.createObjectURL(blob);
      ctx.els.image.src = ctx.url;
    })
    .catch(() => {
      ctx.els.image.alt = "Image not found";
    });
}

function releaseImage(ctx: LightboxContext): void {
  if (ctx.url) URL.revokeObjectURL(ctx.url);
  ctx.url = null;
  ctx.els.image.removeAttribute("src");
}

function close(ctx: LightboxContext): void {
  cancelPendingSeek(ctx);
  ctx.token += 1;
  releaseImage(ctx);
  if (ctx.els.dialog.open) ctx.els.dialog.close();
}

function togglePin(ctx: LightboxContext): void {
  const item = ctx.items[ctx.position];
  if (!item?.pinnable) return;
  ctx.items = ctx.deps.onTogglePin(item);
  const ref = ctx.items[ctx.position]?.ref;
  if (ref) setPinState(ctx.els.pin, ref.pinned);
}
