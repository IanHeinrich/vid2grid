/**
 * Turns fully-described collage sheets into JPEG `Blob`s, rendering them in
 * parallel across a pool of `OffscreenCanvas` workers when the browser supports
 * it and falling back to synchronous main-thread rendering otherwise (e.g. jsdom
 * in tests, or browsers without `OffscreenCanvas`/`Worker`).
 */
import { paintCollageSheet, canvasToJpegBlob, type CollageSheetInput } from "./renderer";
import { WorkerPool } from "./workerPool";
import type { RenderSheetRequest, RenderSheetResponse } from "./renderWorker";

const MAX_RENDER_WORKERS = 4;

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
  sheets: CollageSheetInput[],
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
  sheets: CollageSheetInput[],
  jpegQuality: number,
  onProgress?: SheetProgress,
): Promise<Blob[]> {
  const pool = getPool();
  const blobs = new Array<Blob>(sheets.length);
  let done = 0;

  await Promise.all(
    sheets.map(async (sheet, index) => {
      // Transfer (not copy) the decoded frames into the worker; the worker owns
      // and closes them once the sheet is encoded.
      const response = await pool.run({ input: sheet, jpegQuality }, sheet.bitmaps);
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
  sheets: CollageSheetInput[],
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
    closeBitmaps(sheet.bitmaps);

    blobs.push(blob);
    onProgress?.(blobs.length, sheets.length);
  }
  return blobs;
}

function closeBitmaps(bitmaps: ImageBitmap[]): void {
  for (const bitmap of bitmaps) {
    if (typeof bitmap.close === "function") bitmap.close();
  }
}
