import type { VideoInfo } from "../probe/videoInfo";
import type { Vid2GridWarning } from "../warnings";
import { keyframesInRange } from "./framePlanning";
import type { CollagePlanRequest } from "./request";

export interface KeyframeSamplingDecision {
  request: CollagePlanRequest;
  warning?: Vid2GridWarning;
}

function keyframesUnavailable(reason?: string): Vid2GridWarning {
  const detail = reason === undefined ? "" : ` (${reason})`;
  return {
    code: "keyframes_unavailable",
    message: `Keyframes unavailable${detail}; sampled by target FPS instead`,
  };
}

// buildRenderPlan throws on keyframe mode without times, which is right for a host
// calling it directly; a pipeline is better served by the sampled plan and a warning.
export function resolveKeyframeSampling(
  request: CollagePlanRequest,
  info: VideoInfo,
  keyframeFailure?: string,
): KeyframeSamplingDecision {
  if (request.keyframeSampling !== true) return { request };
  const keyframes = info.keyframeTimestampsSeconds ?? [];
  if (keyframesInRange(keyframes, request.startSeconds, request.endSeconds).length > 0) {
    return { request };
  }
  return {
    request: { ...request, keyframeSampling: false },
    warning: keyframesUnavailable(keyframeFailure),
  };
}
