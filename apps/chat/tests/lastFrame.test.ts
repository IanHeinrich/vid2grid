import { buildRenderPlan, requestFromOptions, type PlanOptionInput } from "@vid2grid/core";
import { describe, expect, it } from "vitest";
import { exactTimes } from "../src/video/exactTimes";
import { endingAtFrame } from "../src/video/lastFrame";

const info = { durationSeconds: 20, width: 1920, height: 1080 };

function plannedTimes(values: PlanOptionInput, last: number | undefined) {
  const inside = endingAtFrame(values, info, last);
  const plan = buildRenderPlan(requestFromOptions(inside, info), info);
  return {
    times: plan.frames.map((frame) => frame.timestampSeconds),
    perSheet: plan.sheets.map((sheet) => sheet.cells.length),
  };
}

describe("endingAtFrame", () => {
  it("leaves a request alone when every time has a frame, or the last is unknown", () => {
    const values = { startSeconds: 0, endSeconds: 20, frameCount: 4, framesPerGrid: 4 };
    expect(endingAtFrame(values, info, 19.9)).toEqual(values);
    expect(endingAtFrame(values, info, undefined)).toEqual(values);
  });

  it("moves exact times back to the last frame, once", () => {
    expect(plannedTimes(exactTimes([10, 19.95]), 19.9)).toEqual({
      times: [10, 19.9],
      perSheet: [2],
    });
    expect(plannedTimes(exactTimes([10, 19.85, 19.95]), 19.8)).toEqual({
      times: [10, 19.8],
      perSheet: [2],
    });
    expect(plannedTimes(exactTimes([19.95]), 19.9).times).toEqual([19.9]);
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
