import { createCanvas, ImageData, type Canvas } from "@napi-rs/canvas";
import {
  paintSheetFromPlan,
  type RenderPlan,
  type SheetContext2D,
  type SheetRenderJob,
} from "@vid2grid/core";
import type { RgbaFrame } from "./capture";

// Painting runs on the main thread but canvas.encode runs on libuv's thread pool, so a
// second sheet lets the next paint overlap the last encode; more would only hold frames.
export const SHEET_ENCODE_CONCURRENCY = 2;

export async function encodeSheet(
  plan: RenderPlan,
  job: SheetRenderJob<RgbaFrame>,
): Promise<Buffer> {
  const canvas = createCanvas(plan.canvas.width, plan.canvas.height);
  paintSheet(canvas.getContext("2d"), plan, job);
  return await canvas.encode("jpeg", plan.jpegQuality);
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
