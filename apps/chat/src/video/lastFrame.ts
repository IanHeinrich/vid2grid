import {
  buildRenderPlan,
  requestFromOptions,
  type PlanOptionInput,
  type VideoInfo,
} from "@vid2grid/core";

// Capture takes the first frame at or after each time, and a video often lasts longer than its
// last frame's start, so a time after that would leave a blank cell.
export function endingAtFrame(
  values: PlanOptionInput,
  info: VideoInfo,
  lastFrameSeconds: number | undefined,
): PlanOptionInput {
  if (lastFrameSeconds === undefined || !plansPast(values, info, lastFrameSeconds)) return values;
  const { startSeconds = 0, timestampsSeconds } = values;
  if (timestampsSeconds !== undefined) {
    return { ...values, ...movedInside(values, timestampsSeconds, lastFrameSeconds) };
  }
  if (startSeconds >= lastFrameSeconds) {
    const single = { ...values, frameCount: undefined, targetFps: undefined, framesPerGrid: 1 };
    return { ...single, timestampsSeconds: [lastFrameSeconds] };
  }
  return { ...values, endSeconds: lastFrameSeconds };
}

function plansPast(values: PlanOptionInput, info: VideoInfo, lastFrameSeconds: number): boolean {
  const plan = buildRenderPlan(requestFromOptions(values, info), info);
  return plan.frames.some((frame) => frame.timestampSeconds > lastFrameSeconds);
}

function movedInside(
  { framesPerGrid }: PlanOptionInput,
  times: readonly number[],
  lastFrameSeconds: number,
): PlanOptionInput {
  const inside = [...new Set(times.map((time) => Math.min(time, lastFrameSeconds)))];
  return {
    timestampsSeconds: inside,
    ...(framesPerGrid === times.length && { framesPerGrid: inside.length }),
  };
}
