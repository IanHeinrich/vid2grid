import { paintCollageSheet, type CollageSheetInput } from "@vid2grid/core";

export interface RenderSheetRequest {
  input: CollageSheetInput<ImageBitmap>;
  jpegQuality: number;
}

export interface RenderSheetResponse {
  blob?: Blob;
  error?: string;
}

// The DOM lib types `self` as a Window, so cast to just the surface used here rather
// than pull in the conflicting WebWorker lib.
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

    for (const image of input.images) image.close();
    scope.postMessage({ blob });
  } catch (err) {
    scope.postMessage({ error: (err as Error).message });
  }
};
