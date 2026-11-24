import { buildRenderPlan, requestFromOptions, type PlanOptionInput } from "@vid2grid/core";
import { describe, expect, it } from "vitest";
import { endingAtFrame } from "../src/video/lastFrame";

const info = { durationSeconds: 20, width: 1920, height: 1080 };

function plannedTimes(values: PlanOptionInput, last: number | undefined, keyframes?: number[]) {
  const probed = keyframes === undefined ? info : { ...info, keyframeTimestampsSeconds: keyframes };
  const inside = endingAtFrame(values, probed, last);
  const plan = buildRenderPlan(requestFromOptions(inside.values, inside.info), inside.info);
  return {
    times: plan.frames.map((frame) => frame.timestampSeconds),
    perSheet: plan.sheets.map((sheet) => sheet.cells.length),
  };
}

const exact = (framesPerGrid: number, startSeconds: number) => ({
  keyframeSampling: true,
  startSeconds,
  endSeconds: 20,
  framesPerGrid,
});

describe("endingAtFrame", () => {
  it("leaves a request alone when every time has a frame, or the last is unknown", () => {
    const values = { startSeconds: 0, endSeconds: 20, frameCount: 4, framesPerGrid: 4 };
    expect(endingAtFrame(values, info, 19.9)).toEqual({ values, info });
    expect(endingAtFrame(values, info, undefined)).toEqual({ values, info });
  });

  it("moves exact times back to the last frame, once", () => {
    expect(plannedTimes(exact(2, 10), 19.9, [10, 19.95])).toEqual({
      times: [10, 19.9],
      perSheet: [2],
    });
    expect(plannedTimes(exact(3, 10), 19.8, [10, 19.85, 19.95])).toEqual({
      times: [10, 19.8],
      perSheet: [2],
    });
    expect(plannedTimes(exact(1, 19.95), 19.9, [19.95]).times).toEqual([19.9]);
  });

  it("spreads a range over the part that has frames", () => {
    const values = { startSeconds: 0, endSeconds: 20, frameCount: 8, framesPerGrid: 8 };
    const { times, perSheet } = plannedTimes(values, 10);
    expect(times).toHaveLength(8);
    expect(Math.max(...times)).toBeLessThanOrEqual(10);
    expect(perSheet).toEqual([8]);
  });

  it("shows the last frame for a range wholly after it", () => {
    const values = { startSeconds: 15, endSeconds: 20, frameCount: 8, framesPerGrid: 4 };
    expect(plannedTimes(values, 10)).toEqual({ times: [10], perSheet: [1] });
  });
});
