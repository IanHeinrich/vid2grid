/**
 * Off-main-thread collage renderer + JPEG encoder.
 *
 * Receives one fully-described collage sheet (frames already decoded to
 * transferable `ImageBitmap`s), paints it onto an `OffscreenCanvas`, and encodes
 * it to a JPEG `Blob` so the render/encode phase runs in parallel across a
 * pool of these workers instead of blocking the UI thread.
 */
import { paintCollageSheet, type CollageSheetInput } from "./renderer";

export interface RenderSheetRequest {
  input: CollageSheetInput;
  jpegQuality: number;
}

export interface RenderSheetResponse {
  blob?: Blob;
  error?: string;
}

// The DOM lib types `self` as a Window; cast to just the worker surface we use
// so we don't have to pull in the conflicting WebWorker lib.
interface RenderWorkerScope {
  onmessage: ((event: MessageEvent<RenderSheetRequest>) => void) | null;
  postMessage(message: RenderSheetResponse): void;
}

const scope = self as unknown as RenderWorkerScope;

scope.onmessage = async (event) => {
  const { input, jpegQuality } = event.data;
  try {
    const canvas = new OffscreenCanvas(input.outputResolution, input.outputResolution);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("OffscreenCanvas 2D context unavailable");

    paintCollageSheet(ctx, input);
    const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: jpegQuality / 100 });

    for (const bitmap of input.bitmaps) bitmap.close();
    scope.postMessage({ blob });
  } catch (err) {
    scope.postMessage({ error: (err as Error).message });
  }
};
