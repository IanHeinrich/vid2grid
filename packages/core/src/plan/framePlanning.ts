import { Vid2GridError } from "../errors";
import type { VideoInfo } from "../probe/videoInfo";
import type { CollagePlanRequest } from "./request";
import type { PlannedFrame } from "./renderPlan";

export const MICROSECONDS_PER_SECOND = 1e6;

// Spelled out because Math.round rounds a half up where Python's round rounds a
// half to even: the two ports would disagree on exact half-microseconds.
export function secondsToMicroseconds(seconds: number): number {
  return Math.floor(seconds * MICROSECONDS_PER_SECOND + 0.5);
}

export function roundToMicroseconds(seconds: number): number {
  return secondsToMicroseconds(seconds) / MICROSECONDS_PER_SECOND;
}

export function keyframesInRange(
  keyframes: readonly number[],
  startSeconds: number,
  endSeconds: number,
): number[] {
  return keyframes.filter((timestamp) => timestamp >= startSeconds && timestamp <= endSeconds);
}

export function subsampleEvenly<T>(values: readonly T[], max: number): T[] {
  if (max >= values.length) return [...values];
  const kept: T[] = [];
  for (let i = 0; i < max; i++) {
    const value = values[Math.floor((i * values.length) / max)];
    if (value !== undefined) kept.push(value);
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
    throw new Vid2GridError(
      "invalid_request",
      "keyframe_sampling needs keyframe_timestamps_seconds, which this video info has none of",
    );
  }
  const inRange = keyframesInRange(keyframes, request.startSeconds, request.endSeconds);
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
