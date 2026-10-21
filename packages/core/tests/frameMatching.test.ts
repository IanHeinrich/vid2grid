import { describe, expect, it } from "vitest";
import {
  createFrameMatcher,
  isKeyframePlan,
  plannedIndicesFilledBy,
} from "../src/plan/frameMatching";

const framesAt = (timestamps: number[]) => ({
  frames: timestamps.map((timestampSeconds, frameIndex) => ({ frameIndex, timestampSeconds })),
});

describe("isKeyframePlan", () => {
  it("is true only when every planned time is a keyframe", () => {
    expect(isKeyframePlan(framesAt([0, 2]), [0, 1, 2])).toBe(true);
    expect(isKeyframePlan(framesAt([0, 0.5]), [0, 1, 2])).toBe(false);
  });

  it("compares both sides at whole microseconds", () => {
    expect(isKeyframePlan(framesAt([1 / 3]), [0.333333])).toBe(true);
    expect(isKeyframePlan(framesAt([0.333333]), [1 / 3])).toBe(true);
  });

  it("is false without keyframe times", () => {
    expect(isKeyframePlan(framesAt([0]), undefined)).toBe(false);
  });
});

describe("plannedIndicesFilledBy", () => {
  const planned = [0, 0.333333, 0.666667];

  it("fills every planned time at or before the frame, from the next unfilled one", () => {
    expect(plannedIndicesFilledBy(planned, 0, 0)).toEqual([0]);
    expect(plannedIndicesFilledBy(planned, 1, 0.7)).toEqual([1, 2]);
  });

  it("fills nothing with a frame before the next planned time, or once all are filled", () => {
    expect(plannedIndicesFilledBy(planned, 1, 0.25)).toEqual([]);
    expect(plannedIndicesFilledBy(planned, 3, 9)).toEqual([]);
  });

  it("fills nothing with a frame whose time is not a number", () => {
    expect(plannedIndicesFilledBy(planned, 0, NaN)).toEqual([]);
    expect(plannedIndicesFilledBy(planned, 0, Infinity)).toEqual([]);
  });

  it("compares at whole microseconds", () => {
    expect(plannedIndicesFilledBy(planned, 1, 0.3333325)).toEqual([1]);
    expect(plannedIndicesFilledBy(planned, 1, 0.3333324)).toEqual([]);
  });
});

describe("createFrameMatcher", () => {
  // tiny.mp4 decodes a frame every 0.1 s; these are the frames Python's capture picks
  // for a 3 fps plan.
  it("gives each planned time the first decoded frame at or after it", () => {
    const planned = [0, 0.333333, 0.666667, 1, 1.333333];
    const matcher = createFrameMatcher(planned);
    const picked: number[] = [];
    for (let frame = 0; frame < 30 && !matcher.done; frame++) {
      const seconds = frame / 10;
      picked.push(...matcher.fill(seconds).map(() => seconds));
    }
    expect(picked).toEqual([0, 0.4, 0.7, 1, 1.4]);
    expect(matcher.done).toBe(true);
  });

  it("leaves the matcher where it was for a frame with no time", () => {
    const matcher = createFrameMatcher([0, 1]);
    expect(matcher.fill(NaN)).toEqual([]);
    expect(matcher.fill(0)).toEqual([0]);
    expect(matcher.done).toBe(false);
  });

  it("keeps a frame the decoder never emitted from shifting the ones after it", () => {
    const matcher = createFrameMatcher([0, 0.333333, 0.666667]);
    expect(matcher.fill(0)).toEqual([0]);
    expect(matcher.fill(0.666667)).toEqual([1, 2]);
  });

  it("lets one decoded frame fill several planned times", () => {
    const matcher = createFrameMatcher([0.1, 0.2, 0.3]);
    expect(matcher.fill(0.25)).toEqual([0, 1]);
    expect(matcher.done).toBe(false);
    expect(matcher.fill(0.3)).toEqual([2]);
    expect(matcher.done).toBe(true);
  });
});
