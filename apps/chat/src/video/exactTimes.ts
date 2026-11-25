import type { PlanOptionInput } from "@vid2grid/core";

// A frame at the very end of the video has nothing to decode, so keep the request inside it.
const END_MARGIN_SECONDS = 0.05;

export function latestFrameTime(durationSeconds: number): number {
  return Math.max(0, durationSeconds - END_MARGIN_SECONDS);
}

export function exactTimes(times: readonly number[]): PlanOptionInput {
  return { timestampsSeconds: [...times], framesPerGrid: times.length };
}
