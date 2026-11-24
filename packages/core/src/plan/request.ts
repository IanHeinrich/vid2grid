import { Vid2GridError } from "../errors";

export const TRANSCRIPT_SCOPES = ["per-sheet", "combined"] as const;
export type TranscriptScope = (typeof TRANSCRIPT_SCOPES)[number];

export const AREA_SCALE = 1000;

// In thousandths of the displayed picture, from its top left.
export interface PictureArea {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

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
  // In place of sampling: these exact times, in any order. The range then only bounds the
  // transcript.
  timestampsSeconds?: number[];
  // Renders only this part of the picture.
  area?: PictureArea;
  framesPerGrid: number;
  outputResolution: number;
  jpegQuality: number;
  transcript?: { scope: TranscriptScope };
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
  const timestampsProblem = explicitTimestampsProblem(request);
  if (timestampsProblem !== undefined) return timestampsProblem;
  const pictureAreaProblem = request.area && areaProblem(request.area);
  if (pictureAreaProblem !== undefined) return pictureAreaProblem;
  if (request.transcript !== undefined && !TRANSCRIPT_SCOPES.includes(request.transcript.scope)) {
    return "transcript_scope must be per-sheet or combined";
  }
  return undefined;
}

export function validateCollagePlanRequest(request: CollagePlanRequest): void {
  const problem = collagePlanRequestProblem(request);
  if (problem !== undefined) throw new Vid2GridError("invalid_request", problem);
}

function explicitTimestampsProblem(request: CollagePlanRequest): string | undefined {
  const { timestampsSeconds } = request;
  if (timestampsSeconds === undefined) return undefined;
  if (timestampsSeconds.length === 0) return "timestamps_seconds must not be empty";
  if (!timestampsSeconds.every((seconds) => Number.isFinite(seconds) && seconds >= 0)) {
    return "timestamps_seconds must be finite numbers, 0 or more";
  }
  if (
    request.keyframeSampling === true ||
    request.frameCount !== undefined ||
    request.maxKeyframes !== undefined
  ) {
    return "timestamps_seconds cannot be combined with keyframe_sampling, frame_count or max_keyframes";
  }
  return undefined;
}

function areaProblem({ left, top, right, bottom }: PictureArea): string | undefined {
  if (![left, top, right, bottom].every((side) => side >= 0 && side <= AREA_SCALE)) {
    return `area's sides must be thousandths of the picture, 0 to ${AREA_SCALE}`;
  }
  if (left >= right) return "area's left must be less than its right";
  if (top >= bottom) return "area's top must be less than its bottom";
  return undefined;
}

function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}
