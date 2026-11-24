import {
  buildRenderPlan,
  requestFromOptions,
  type PlanOptionInput,
  type VideoInfo,
} from "@vid2grid/core";

export interface RenderInput {
  values: PlanOptionInput;
  info: VideoInfo;
}

// Capture takes the first frame at or after each time, and a video often lasts longer than its
// last frame's start, so a time after that would leave a blank cell.
export function endingAtFrame(
  values: PlanOptionInput,
  info: VideoInfo,
  lastFrameSeconds: number | undefined,
): RenderInput {
  if (lastFrameSeconds === undefined || !plansPast(values, info, lastFrameSeconds)) {
    return { values, info };
  }
  const { startSeconds = 0 } = values;
  const times = values.keyframeSampling === true ? info.keyframeTimestampsSeconds : undefined;
  if (times !== undefined) return atTimes(values, info, times, lastFrameSeconds);
  if (startSeconds >= lastFrameSeconds) {
    const single = { ...values, frameCount: undefined, targetFps: undefined, framesPerGrid: 1 };
    return atTimes(
      { ...single, keyframeSampling: true },
      info,
      [lastFrameSeconds],
      lastFrameSeconds,
    );
  }
  return { values: { ...values, endSeconds: lastFrameSeconds }, info };
}

function plansPast(values: PlanOptionInput, info: VideoInfo, lastFrameSeconds: number): boolean {
  const plan = buildRenderPlan(requestFromOptions(values, info), info);
  return plan.frames.some((frame) => frame.timestampSeconds > lastFrameSeconds);
}

function atTimes(
  values: PlanOptionInput,
  info: VideoInfo,
  times: readonly number[],
  lastFrameSeconds: number,
): RenderInput {
  const inside = [...new Set(times.map((time) => Math.min(time, lastFrameSeconds)))];
  const { startSeconds = 0, framesPerGrid } = values;
  return {
    values: {
      ...values,
      startSeconds: Math.min(startSeconds, lastFrameSeconds),
      ...(framesPerGrid === times.length && { framesPerGrid: inside.length }),
    },
    info: { ...info, keyframeTimestampsSeconds: inside },
  };
}
