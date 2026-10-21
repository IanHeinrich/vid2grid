import { Vid2GridError } from "../errors";

// Flat sampling fields rather than a discriminated union: targetFps still decides the
// burned-in timestamp's precision in keyframe mode, where it plays no part in choosing frames.
export interface CollagePlanRequest {
  startSeconds: number;
  endSeconds: number;
  targetFps: number;
  // Sampled mode only: exactly this many frames, evenly spaced, in place of targetFps.
  frameCount?: number;
  keyframeSampling?: boolean;
  // Keyframe mode only: the keyframes are thinned out evenly to at most this many.
  maxKeyframes?: number;
  framesPerGrid: number;
  outputResolution: number;
  jpegQuality: number;
  transcript?: { scope: "per-sheet" | "combined" };
}

export type SamplingRange = Pick<CollagePlanRequest, "startSeconds" | "endSeconds" | "targetFps">;

export function samplingRangeProblem(range: SamplingRange): string | undefined {
  if (range.endSeconds <= range.startSeconds) return "end_time must be greater than start_time";
  if (range.targetFps <= 0) return "target_fps must be positive";
  return undefined;
}

export function collagePlanRequestProblem(request: CollagePlanRequest): string | undefined {
  const rangeProblem = samplingRangeProblem(request);
  if (rangeProblem !== undefined) return rangeProblem;
  if (request.framesPerGrid <= 0) return "frames_per_grid must be positive";
  if (request.outputResolution <= 0) return "output_resolution must be positive";
  if (request.jpegQuality < 1 || request.jpegQuality > 100) {
    return "jpeg_quality must be between 1 and 100";
  }
  if (request.frameCount !== undefined && !isPositiveInteger(request.frameCount)) {
    return "frame_count must be a positive integer";
  }
  if (request.maxKeyframes !== undefined && !isPositiveInteger(request.maxKeyframes)) {
    return "max_keyframes must be a positive integer";
  }
  return undefined;
}

export function validateCollagePlanRequest(request: CollagePlanRequest): void {
  const problem = collagePlanRequestProblem(request);
  if (problem !== undefined) throw new Vid2GridError("invalid_request", problem);
}

function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}
