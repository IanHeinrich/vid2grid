import { createCanvas, ImageData, type Canvas } from "@napi-rs/canvas";
import {
  paintSheetFromPlan,
  type PortProgressCallback,
  type RenderPlan,
  type SheetContext2D,
  type SheetRenderJob,
} from "@vid2grid/core";
import type { RgbaFrame } from "./capture";

// One sheet at a time, so only one sheet-sized canvas is alive at once.
export async function encodeSheets(
  plan: RenderPlan,
  jobs: SheetRenderJob<RgbaFrame>[],
  onProgress?: PortProgressCallback,
): Promise<Buffer[]> {
  const sheets: Buffer[] = [];
  for (const job of jobs) {
    const canvas = createCanvas(plan.canvas.width, plan.canvas.height);
    paintSheet(canvas.getContext("2d"), plan, job);
    sheets.push(await canvas.encode("jpeg", plan.jpegQuality));
    onProgress?.({ done: sheets.length, total: jobs.length });
  }
  return sheets;
}

// Takes any SheetContext2D so conformance tests can record what reaches the canvas.
export function paintSheet(
  ctx: SheetContext2D<Canvas>,
  plan: RenderPlan,
  job: SheetRenderJob<RgbaFrame>,
): void {
  const images = job.images.map((image) => image && frameCanvas(image));
  paintSheetFromPlan(ctx, plan, job.sheet, images);
}

function frameCanvas(frame: RgbaFrame): Canvas {
  const canvas = createCanvas(frame.width, frame.height);
  canvas.getContext("2d").putImageData(new ImageData(frame.data, frame.width, frame.height), 0, 0);
  return canvas;
}
