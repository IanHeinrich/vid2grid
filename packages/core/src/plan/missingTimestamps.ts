import type { Vid2GridWarning } from "../warnings";
import type { RenderPlan } from "./renderPlan";
import type { CollagePlanRequest } from "./request";

// Images come in plan order, so the times with no frame are the ones after the last image.
export function missingTimestampsWarning(
  request: Pick<CollagePlanRequest, "timestampsSeconds">,
  plan: Pick<RenderPlan, "frames">,
  capturedCount: number,
): Vid2GridWarning | undefined {
  const missing = plan.frames.slice(capturedCount).map((frame) => frame.timestampSeconds);
  if (request.timestampsSeconds === undefined || missing.length === 0) return undefined;
  return {
    code: "no_frame_at_timestamps",
    message: `The video has no frame at or after these times, so no sheet shows them: ${missing.join(", ")}`,
  };
}
