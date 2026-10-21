import { paintSheetFromPlan, type RenderPlan, type SheetRenderJob } from "@vid2grid/core";
import { create2dCanvas } from "../shared/canvas";
import { closeImages } from "../shared/images";
import { canvasToJpegBlob } from "./canvasJpeg";
import { WorkerPool } from "./workerPool";
import type { RenderSheetRequest, RenderSheetResponse } from "./renderWorker";

const MAX_RENDER_WORKERS = 4;
// Ports carry no dispose, so the pool ends itself after this long with no sheet in flight.
// A slow capture between sheets (the seek path) can outlast it: the run then rebuilds the
// pool for its next sheet, which is slower but not wrong.
const IDLE_POOL_LIFETIME_MS = 10_000;

type RenderPool = WorkerPool<RenderSheetRequest, RenderSheetResponse>;
let sharedPool: RenderPool | null = null;
let sheetsInFlight = 0;
let idleTimer: ReturnType<typeof setTimeout> | undefined;

function supportsWorkerRendering(): boolean {
  return typeof Worker !== "undefined" && typeof OffscreenCanvas !== "undefined";
}

function poolSize(): number {
  return Math.max(1, Math.min(navigator.hardwareConcurrency || 4, MAX_RENDER_WORKERS));
}

export function renderConcurrency(): number {
  return supportsWorkerRendering() ? poolSize() : 1;
}

// null when no worker can be started (a CSP SecurityError, say): the sheet then renders on
// the main thread, as it does where Worker is missing altogether.
function acquirePool(): RenderPool | null {
  try {
    sharedPool ??= new WorkerPool<RenderSheetRequest, RenderSheetResponse>(
      () => new Worker(new URL("./renderWorker.ts", import.meta.url), { type: "module" }),
      poolSize(),
    );
  } catch {
    return null;
  }
  clearTimeout(idleTimer);
  sheetsInFlight++;
  return sharedPool;
}

function releasePool(): void {
  sheetsInFlight--;
  if (sheetsInFlight > 0) return;
  idleTimer = setTimeout(() => {
    sharedPool?.terminate();
    sharedPool = null;
  }, IDLE_POOL_LIFETIME_MS);
}

export function renderSheetToBlob(
  plan: RenderPlan,
  job: SheetRenderJob<ImageBitmap>,
): Promise<Blob> {
  const pool = supportsWorkerRendering() ? acquirePool() : null;
  return pool ? renderOnWorker(pool, plan, job) : renderOnMainThread(plan, job);
}

async function renderOnWorker(
  pool: RenderPool,
  plan: RenderPlan,
  job: SheetRenderJob<ImageBitmap>,
): Promise<Blob> {
  try {
    // paintSheetFromPlan reads none of the frame or sheet lists, and they would otherwise
    // be structured-cloned once per sheet.
    const sheetPlan: RenderPlan = { ...plan, frames: [], sheets: [] };
    // The frames are transferred, not copied: the worker closes them once encoded.
    const response = await pool.run(
      { plan: sheetPlan, sheet: job.sheet, images: job.images },
      presentImages(job.images),
    );
    if (response.error || !response.blob) {
      throw new Error(response.error ?? "Render worker returned no image");
    }
    return response.blob;
  } finally {
    // A no-op for frames already transferred; it frees any the worker never received.
    closeImages(job.images);
    releasePool();
  }
}

async function renderOnMainThread(
  plan: RenderPlan,
  job: SheetRenderJob<ImageBitmap>,
): Promise<Blob> {
  try {
    const { canvas, ctx } = create2dCanvas(plan.canvas.width, plan.canvas.height);
    paintSheetFromPlan(ctx, plan, job.sheet, job.images);
    return await canvasToJpegBlob(canvas, plan.jpegQuality);
  } finally {
    closeImages(job.images);
  }
}

function presentImages(images: (ImageBitmap | undefined)[]): ImageBitmap[] {
  return images.filter((image): image is ImageBitmap => image !== undefined);
}
