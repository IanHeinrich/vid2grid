import type { VideoInfo } from "../probe/videoInfo";
import { AREA_SCALE, type PictureArea } from "./request";
import type { PlannedCrop } from "./renderPlan";

interface Span {
  start: number;
  length: number;
}

// At least one pixel, inside the picture: an area in its last half pixel would round past it.
function pixelSpan(from: number, to: number, pixels: number): Span {
  const start = Math.min(Math.round((from * pixels) / AREA_SCALE), pixels - 1);
  const end = Math.round((to * pixels) / AREA_SCALE);
  return { start, length: Math.max(1, end - start) };
}

export function plannedCrop(
  area: PictureArea,
  { width, height }: Pick<VideoInfo, "width" | "height">,
): PlannedCrop {
  const across = pixelSpan(area.left, area.right, width);
  const down = pixelSpan(area.top, area.bottom, height);
  return {
    x: across.start,
    y: down.start,
    width: across.length,
    height: down.length,
    sourceWidth: width,
    sourceHeight: height,
  };
}
