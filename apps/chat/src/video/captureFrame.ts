import { buildRenderPlan, GUTTER_PX, requestFromOptions } from "@vid2grid/core";
import type { FrameCapturePort, RenderPlan, VideoInfo } from "@vid2grid/core";
import { createBrowserPorts } from "@vid2grid/browser";
import { exactTimes } from "./exactTimes";

export const MAX_CAPTURE_PX = 4096;

export interface FramePlan {
  plan: RenderPlan;
  info: VideoInfo;
}

export function framePlan(info: VideoInfo, seconds: number): FramePlan {
  const exact = exactTimes(info, [seconds]);
  const sourceSide = Math.max(info.width, info.height) + 2 * GUTTER_PX;
  const request = requestFromOptions(
    { ...exact.values, outputResolution: Math.min(MAX_CAPTURE_PX, sourceSide) },
    exact.info,
  );
  return { plan: buildRenderPlan(request, exact.info), info: exact.info };
}

// The caller closes the bitmap; undefined where the video has no frame at or after that time.
export async function captureFrame(
  file: File,
  info: VideoInfo,
  seconds: number,
  frames: FrameCapturePort<File, ImageBitmap> = createBrowserPorts().frames,
): Promise<ImageBitmap | undefined> {
  const planned = framePlan(info, seconds);
  let first: ImageBitmap | undefined;
  try {
    for await (const image of frames.capture(file, planned.plan, planned.info)) {
      if (first === undefined) first = image;
      else image.close();
    }
  } catch (error) {
    first?.close();
    throw error;
  }
  return first;
}
