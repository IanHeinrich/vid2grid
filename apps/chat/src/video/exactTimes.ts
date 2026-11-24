import type { PlanOptionInput, VideoInfo } from "@vid2grid/core";

// A frame at the very end of the video has nothing to decode, so keep the request inside it.
const END_MARGIN_SECONDS = 0.05;
// Keyframe ranges are inclusive, so the end only has to sit past the last time.
const KEYFRAME_RANGE_PADDING_SECONDS = 0.01;

export function latestFrameTime(durationSeconds: number): number {
  return Math.max(0, durationSeconds - END_MARGIN_SECONDS);
}

export interface ExactTimes {
  values: PlanOptionInput;
  info: VideoInfo;
}

// Passes the times off as the video's keyframes, since only the keyframe path takes exact times.
export function exactTimes(info: VideoInfo, times: readonly number[]): ExactTimes {
  const first = times[0] ?? 0;
  const last = times[times.length - 1] ?? first;
  return {
    values: {
      keyframeSampling: true,
      startSeconds: first,
      endSeconds: last + KEYFRAME_RANGE_PADDING_SECONDS,
      framesPerGrid: times.length,
    },
    info: { ...info, keyframeTimestampsSeconds: [...times] },
  };
}
