import {
  paintSheetFromPlan,
  type RenderPlan,
  type SheetContext2D,
  type SheetRenderJob,
} from "@vid2grid/core";
import { canvasToJpegBlob } from "./canvasJpeg";
import { WorkerPool } from "./workerPool";
import type { RenderSheetRequest, RenderSheetResponse } from "./renderWorker";

const MAX_RENDER_WORKERS = 4;

// Unused at runtime: compile-time proof that both canvas contexts satisfy core's SheetContext2D.
type AssignableToSheetContext<T extends SheetContext2D<ImageBitmap>> = T;
export type MainThreadSheetContext = AssignableToSheetContext<CanvasRenderingContext2D>;
export type WorkerSheetContext = AssignableToSheetContext<OffscreenCanvasRenderingContext2D>;

export type SheetProgress = (done: number, total: number) => void;

type RenderPool = WorkerPool<RenderSheetRequest, RenderSheetResponse>;
let sharedPool: RenderPool | null = null;

function supportsWorkerRendering(): boolean {
  return typeof Worker !== "undefined" && typeof OffscreenCanvas !== "undefined";
}

function getPool(): RenderPool {
  if (!sharedPool) {
    const size = Math.max(1, Math.min(navigator.hardwareConcurrency || 4, MAX_RENDER_WORKERS));
    sharedPool = new WorkerPool<RenderSheetRequest, RenderSheetResponse>(
      () => new Worker(new URL("./renderWorker.ts", import.meta.url), { type: "module" }),
      size,
    );
  }
  return sharedPool;
}

export async function renderSheetsToBlobs(
  plan: RenderPlan,
  jobs: SheetRenderJob<ImageBitmap>[],
  onProgress?: SheetProgress,
): Promise<Blob[]> {
  if (jobs.length === 0) return [];
  if (supportsWorkerRendering()) {
    return renderWithWorkers(plan, jobs, onProgress);
  }
  return renderOnMainThread(plan, jobs, onProgress);
}

async function renderWithWorkers(
  plan: RenderPlan,
  jobs: SheetRenderJob<ImageBitmap>[],
  onProgress?: SheetProgress,
): Promise<Blob[]> {
  const pool = getPool();
  const blobs = new Array<Blob>(jobs.length);
  let done = 0;

  await Promise.all(
    jobs.map(async (job, index) => {
      // The frames are transferred, not copied: the worker closes them once encoded.
      const response = await pool.run(
        { plan, sheet: job.sheet, images: job.images, jpegQuality: plan.jpegQuality },
        presentImages(job.images),
      );
      if (response.error || !response.blob) {
        throw new Error(response.error ?? "Render worker returned no image");
      }
      blobs[index] = response.blob;
      done++;
      onProgress?.(done, jobs.length);
    }),
  );

  return blobs;
}

async function renderOnMainThread(
  plan: RenderPlan,
  jobs: SheetRenderJob<ImageBitmap>[],
  onProgress?: SheetProgress,
): Promise<Blob[]> {
  const blobs: Blob[] = [];
  for (const job of jobs) {
    const canvas = document.createElement("canvas");
    canvas.width = plan.canvas.width;
    canvas.height = plan.canvas.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D context unavailable");

    paintSheetFromPlan(ctx, plan, job.sheet, job.images);
    const blob = await canvasToJpegBlob(canvas, plan.jpegQuality);
    closeImages(job.images);

    blobs.push(blob);
    onProgress?.(blobs.length, jobs.length);
  }
  return blobs;
}

function presentImages(images: (ImageBitmap | undefined)[]): ImageBitmap[] {
  return images.filter((image): image is ImageBitmap => image !== undefined);
}

function closeImages(images: (ImageBitmap | undefined)[]): void {
  for (const image of presentImages(images)) {
    if (typeof image.close === "function") image.close();
  }
}
