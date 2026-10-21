import { paintSheetFromPlan, type PlannedSheet, type RenderPlan } from "@vid2grid/core";
import { create2dOffscreenCanvas } from "../shared/canvas";
import { errorMessage } from "../shared/errors";
import { closeImages } from "../shared/images";
import { getWorkerScope } from "../shared/workerScope";
import { jpegQualityFraction } from "./canvasJpeg";

export interface RenderSheetRequest {
  plan: RenderPlan;
  sheet: PlannedSheet;
  images: (ImageBitmap | undefined)[];
}

export interface RenderSheetResponse {
  blob?: Blob;
  error?: string;
}

const scope = getWorkerScope<RenderSheetRequest, RenderSheetResponse>();

scope.onmessage = async (event) => {
  const { plan, sheet, images } = event.data;
  try {
    const { canvas, ctx } = create2dOffscreenCanvas(plan.canvas.width, plan.canvas.height);

    paintSheetFromPlan(ctx, plan, sheet, images);
    const blob = await canvas.convertToBlob({
      type: "image/jpeg",
      quality: jpegQualityFraction(plan.jpegQuality),
    });
    scope.postMessage({ blob });
  } catch (err) {
    scope.postMessage({ error: errorMessage(err) });
  } finally {
    closeImages(images);
  }
};
