import { paintCollageSheet, type CollageSheetInput, type SheetContext2D } from "@vid2grid/core";
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
  sheets: CollageSheetInput<ImageBitmap>[],
  jpegQuality: number,
  onProgress?: SheetProgress,
): Promise<Blob[]> {
  if (sheets.length === 0) return [];
  if (supportsWorkerRendering()) {
    return renderWithWorkers(sheets, jpegQuality, onProgress);
  }
  return renderOnMainThread(sheets, jpegQuality, onProgress);
}

async function renderWithWorkers(
  sheets: CollageSheetInput<ImageBitmap>[],
  jpegQuality: number,
  onProgress?: SheetProgress,
): Promise<Blob[]> {
  const pool = getPool();
  const blobs = new Array<Blob>(sheets.length);
  let done = 0;

  await Promise.all(
    sheets.map(async (sheet, index) => {
      // The frames are transferred, not copied: the worker closes them once encoded.
      const response = await pool.run({ input: sheet, jpegQuality }, sheet.images);
      if (response.error || !response.blob) {
        throw new Error(response.error ?? "Render worker returned no image");
      }
      blobs[index] = response.blob;
      done++;
      onProgress?.(done, sheets.length);
    }),
  );

  return blobs;
}

async function renderOnMainThread(
  sheets: CollageSheetInput<ImageBitmap>[],
  jpegQuality: number,
  onProgress?: SheetProgress,
): Promise<Blob[]> {
  const blobs: Blob[] = [];
  for (const sheet of sheets) {
    const canvas = document.createElement("canvas");
    canvas.width = sheet.outputResolution;
    canvas.height = sheet.outputResolution;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D context unavailable");

    paintCollageSheet(ctx, sheet);
    const blob = await canvasToJpegBlob(canvas, jpegQuality);
    closeImages(sheet.images);

    blobs.push(blob);
    onProgress?.(blobs.length, sheets.length);
  }
  return blobs;
}

function closeImages(images: ImageBitmap[]): void {
  for (const image of images) {
    if (typeof image.close === "function") image.close();
  }
}
