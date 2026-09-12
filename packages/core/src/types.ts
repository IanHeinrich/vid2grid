/** Display-oriented source dimensions: any container rotation is already applied. */
export interface VideoInfo {
  durationSeconds: number;
  width: number;
  height: number;
  /** Ascending keyframe composition times, when the probe can read them cheaply. */
  keyframeTimestampsSeconds?: number[];
}

// Flat sampling fields rather than a discriminated union: targetFps still
// decides the burned-in timestamp's precision in keyframe mode, where it plays
// no part in choosing the frames.
export interface CollagePlanRequest {
  startSeconds: number;
  endSeconds: number;
  targetFps: number;
  /** Sampled mode: exactly this many frames, evenly spaced across the range. */
  frameCount?: number;
  /** Capture the source's own keyframes instead of sampling by time. */
  keyframeSampling?: boolean;
  /** Keyframe mode: thin the keyframes out evenly to at most this many. */
  maxKeyframes?: number;
  framesPerGrid: number;
  outputResolution: number;
  jpegQuality: number;
  transcript?: { scope: "per-sheet" | "combined" };
}

export function validateCollagePlanRequest(request: CollagePlanRequest): void {
  if (request.endSeconds <= request.startSeconds) {
    throw new Error("end_time must be greater than start_time");
  }
  if (request.targetFps <= 0) {
    throw new Error("target_fps must be positive");
  }
  if (request.framesPerGrid <= 0) {
    throw new Error("frames_per_grid must be positive");
  }
  if (request.outputResolution <= 0) {
    throw new Error("output_resolution must be positive");
  }
  if (request.jpegQuality < 1 || request.jpegQuality > 100) {
    throw new Error("jpeg_quality must be between 1 and 100");
  }
  if (request.frameCount !== undefined && !isPositiveInteger(request.frameCount)) {
    throw new Error("frame_count must be a positive integer");
  }
  if (request.maxKeyframes !== undefined && !isPositiveInteger(request.maxKeyframes)) {
    throw new Error("max_keyframes must be a positive integer");
  }
}

function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}
