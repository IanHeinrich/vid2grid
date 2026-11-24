import { buildRenderPlan, GUTTER_PX, requestFromOptions } from "@vid2grid/core";
import type { FrameCapturePort, RenderPlan, VideoInfo } from "@vid2grid/core";
import { createBrowserPorts } from "@vid2grid/browser";
import { exactTimes } from "./exactTimes";

export const MAX_CAPTURE_PX = 4096;

export function framePlan(info: VideoInfo, seconds: number): RenderPlan {
  const sourceSide = Math.max(info.width, info.height) + 2 * GUTTER_PX;
  const request = requestFromOptions(
    { ...exactTimes([seconds]), outputResolution: Math.min(MAX_CAPTURE_PX, sourceSide) },
    info,
  );
  return buildRenderPlan(request, info);
}

// The caller closes the bitmap; undefined where the video has no frame at or after that time.
export async function captureFrame(
  file: File,
  info: VideoInfo,
  seconds: number,
  frames: FrameCapturePort<File, ImageBitmap> = createBrowserPorts().frames,
): Promise<ImageBitmap | undefined> {
  const plan = framePlan(info, seconds);
  let first: ImageBitmap | undefined;
  try {
    for await (const image of frames.capture(file, plan, info)) {
      if (first === undefined) first = image;
      else image.close();
    }
  } catch (error) {
    first?.close();
    throw error;
  }
  return first;
}
