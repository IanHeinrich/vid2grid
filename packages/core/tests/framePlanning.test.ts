import { describe, expect, it } from "vitest";
import {
  planFrameTimestamps,
  roundToMicroseconds,
  subsampleEvenly,
} from "../src/plan/framePlanning";
import type { CollagePlanRequest, VideoInfo } from "../src/types";

const INFO: VideoInfo = { durationSeconds: 10, width: 640, height: 480 };

function request(overrides: Partial<CollagePlanRequest> = {}): CollagePlanRequest {
  return {
    startSeconds: 0,
    endSeconds: 3,
    targetFps: 2,
    framesPerGrid: 4,
    outputResolution: 512,
    jpegQuality: 80,
    ...overrides,
  };
}

const timestampsOf = (req: CollagePlanRequest, info: VideoInfo = INFO): number[] =>
  planFrameTimestamps(req, info).map((frame) => frame.timestampSeconds);

describe("roundToMicroseconds", () => {
  it("snaps to whole microseconds", () => {
    expect(roundToMicroseconds(1 / 3)).toBe(0.333333);
    expect(roundToMicroseconds(0.0000004)).toBe(0);
    expect(roundToMicroseconds(0.0000005)).toBe(0.000001);
    expect(roundToMicroseconds(2.5)).toBe(2.5);
  });
});

describe("subsampleEvenly", () => {
  it("keeps every value when the cap is not smaller than the list", () => {
    expect(subsampleEvenly([1, 2, 3], 3)).toEqual([1, 2, 3]);
    expect(subsampleEvenly([1, 2, 3], 9)).toEqual([1, 2, 3]);
  });

  it("keeps the value at floor(i * n / m), starting with the first", () => {
    expect(subsampleEvenly([0, 1, 2, 3, 4, 5, 6, 7, 8], 3)).toEqual([0, 3, 6]);
    expect(subsampleEvenly([0, 1, 2, 3, 4], 2)).toEqual([0, 2]);
    expect(subsampleEvenly([0, 1, 2, 3, 4], 1)).toEqual([0]);
  });
});

describe("planFrameTimestamps, sampled mode", () => {
  it("steps by 1 / targetFps from the start, floor(range * fps) times", () => {
    expect(timestampsOf(request())).toEqual([0, 0.5, 1, 1.5, 2, 2.5]);
  });

  it("indexes frames from zero in order", () => {
    expect(planFrameTimestamps(request({ endSeconds: 1 }), INFO)).toEqual([
      { frameIndex: 0, timestampSeconds: 0 },
      { frameIndex: 1, timestampSeconds: 0.5 },
    ]);
  });

  it("always plans at least one frame, even for a sub-step range", () => {
    expect(timestampsOf(request({ startSeconds: 1, endSeconds: 1.1 }))).toEqual([1]);
  });

  it("drops timestamps at or past the video's duration", () => {
    const info: VideoInfo = { ...INFO, durationSeconds: 1.2 };
    expect(timestampsOf(request({ endSeconds: 3 }), info)).toEqual([0, 0.5, 1]);
  });

  it("spaces frameCount frames evenly across the whole range", () => {
    expect(timestampsOf(request({ endSeconds: 4, frameCount: 4 }))).toEqual([0, 1, 2, 3]);
    expect(timestampsOf(request({ startSeconds: 1, endSeconds: 3, frameCount: 4 }))).toEqual([
      1, 1.5, 2, 2.5,
    ]);
  });

  it("rounds frameCount spacing to whole microseconds", () => {
    expect(timestampsOf(request({ endSeconds: 1, frameCount: 3 }))).toEqual([
      0, 0.333333, 0.666667,
    ]);
  });
});

describe("planFrameTimestamps, keyframe mode", () => {
  const keyframes = [0, 0.333333, 0.666667, 1, 1.333333];
  const info: VideoInfo = { ...INFO, keyframeTimestampsSeconds: keyframes };

  it("takes every keyframe inside the range, inclusive of both ends", () => {
    expect(timestampsOf(request({ keyframeSampling: true, endSeconds: 1 }), info)).toEqual([
      0, 0.333333, 0.666667, 1,
    ]);
    expect(
      timestampsOf(request({ keyframeSampling: true, startSeconds: 0.4, endSeconds: 1 }), info),
    ).toEqual([0.666667, 1]);
  });

  it("ignores targetFps and the video duration cut", () => {
    expect(timestampsOf(request({ keyframeSampling: true, targetFps: 100 }), info)).toEqual(
      keyframes,
    );
  });

  it("thins the keyframes down to maxKeyframes", () => {
    expect(timestampsOf(request({ keyframeSampling: true, maxKeyframes: 2 }), info)).toEqual([
      0, 0.666667,
    ]);
  });

  it("plans nothing when no keyframe falls in the range", () => {
    expect(
      timestampsOf(request({ keyframeSampling: true, startSeconds: 2, endSeconds: 3 }), info),
    ).toEqual([]);
  });

  it("throws when the video info carries no keyframe timestamps", () => {
    expect(() => planFrameTimestamps(request({ keyframeSampling: true }), INFO)).toThrowError(
      /keyframe_timestamps_seconds/,
    );
  });
});
