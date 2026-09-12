import { paintSheetFromPlan, type PlannedSheet, type RenderPlan } from "@vid2grid/core";

export interface RenderSheetRequest {
  plan: RenderPlan;
  sheet: PlannedSheet;
  images: (ImageBitmap | undefined)[];
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
  const { plan, sheet, images, jpegQuality } = event.data;
  try {
    const canvas = new OffscreenCanvas(plan.canvas.width, plan.canvas.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("OffscreenCanvas 2D context unavailable");

    paintSheetFromPlan(ctx, plan, sheet, images);
    const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: jpegQuality / 100 });

    for (const image of images) image?.close();
    scope.postMessage({ blob });
  } catch (err) {
    scope.postMessage({ error: (err as Error).message });
  }
};
