import type { CollagePlanRequest, VideoInfo } from "../types";
import type { PlannedFrame } from "./renderPlan";

// Spelled out because Math.round rounds a half up where Python's round rounds a
// half to even: the two ports would disagree on exact half-microseconds.
export function roundToMicroseconds(seconds: number): number {
  return Math.floor(seconds * 1e6 + 0.5) / 1e6;
}

export function subsampleEvenly<T>(values: readonly T[], max: number): T[] {
  if (max >= values.length) return [...values];
  const kept: T[] = [];
  for (let i = 0; i < max; i++) {
    kept.push(values[Math.floor((i * values.length) / max)]);
  }
  return kept;
}

export function planFrameTimestamps(request: CollagePlanRequest, info: VideoInfo): PlannedFrame[] {
  const timestamps = request.keyframeSampling
    ? keyframeTimestamps(request, info)
    : sampledTimestamps(request, info);
  return timestamps.map((timestampSeconds, frameIndex) => ({ frameIndex, timestampSeconds }));
}

function keyframeTimestamps(request: CollagePlanRequest, info: VideoInfo): number[] {
  const keyframes = info.keyframeTimestampsSeconds;
  if (!keyframes) {
    throw new Error(
      "keyframe_sampling needs keyframe_timestamps_seconds, which this video info has none of",
    );
  }
  const inRange = keyframes.filter(
    (timestamp) => timestamp >= request.startSeconds && timestamp <= request.endSeconds,
  );
  const selected =
    request.maxKeyframes === undefined ? inRange : subsampleEvenly(inRange, request.maxKeyframes);
  return selected.map(roundToMicroseconds);
}

function sampledTimestamps(request: CollagePlanRequest, info: VideoInfo): number[] {
  const rangeSeconds = request.endSeconds - request.startSeconds;
  const count = request.frameCount ?? Math.max(1, Math.floor(rangeSeconds * request.targetFps));
  const step =
    request.frameCount === undefined ? 1 / request.targetFps : rangeSeconds / request.frameCount;

  const timestamps: number[] = [];
  for (let i = 0; i < count; i++) {
    const timestamp = roundToMicroseconds(request.startSeconds + i * step);
    if (timestamp >= info.durationSeconds) break;
    timestamps.push(timestamp);
  }
  return timestamps;
}
