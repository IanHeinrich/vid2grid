import { describe, expect, it } from "vitest";
import { Vid2GridError } from "../src/errors";
import {
  collagePlanRequestProblem,
  samplingRangeProblem,
  validateCollagePlanRequest,
  type CollagePlanRequest,
} from "../src/plan/request";

function request(overrides: Partial<CollagePlanRequest> = {}): CollagePlanRequest {
  return {
    startSeconds: 0,
    endSeconds: 3,
    targetFps: 2,
    framesPerGrid: 4,
    outputResolution: 512,
    jpegQuality: 85,
    ...overrides,
  };
}

const UNKNOWN_SCOPE = { scope: "both" } as unknown as NonNullable<CollagePlanRequest["transcript"]>;

const BAD_TIMESTAMPS = "timestamps_seconds must be finite numbers, 0 or more";
const TIMESTAMPS_COMBINED =
  "timestamps_seconds cannot be combined with keyframe_sampling, frame_count or max_keyframes";

const WHOLE_PICTURE = { left: 0, top: 0, right: 1000, bottom: 1000 };
const BAD_AREA = "area's sides must be thousandths of the picture, 0 to 1000";

function validationError(overrides: Partial<CollagePlanRequest>): unknown {
  try {
    validateCollagePlanRequest(request(overrides));
  } catch (err) {
    return err;
  }
  return undefined;
}

describe("validateCollagePlanRequest", () => {
  it("accepts a well-formed request", () => {
    expect(() => validateCollagePlanRequest(request())).not.toThrow();
    expect(() =>
      validateCollagePlanRequest(request({ frameCount: 3, maxKeyframes: 2, jpegQuality: 100 })),
    ).not.toThrow();
    expect(() =>
      validateCollagePlanRequest(request({ transcript: { scope: "combined" } })),
    ).not.toThrow();
    expect(() =>
      validateCollagePlanRequest(request({ timestampsSeconds: [7, 0], keyframeSampling: false })),
    ).not.toThrow();
    expect(() => validateCollagePlanRequest(request({ area: WHOLE_PICTURE }))).not.toThrow();
  });

  it.each<[string, Partial<CollagePlanRequest>, string]>([
    ["an empty range", { endSeconds: 0 }, "end_time must be greater than start_time"],
    ["a zero-length range", { startSeconds: 3 }, "end_time must be greater than start_time"],
    ["a non-positive fps", { targetFps: 0 }, "target_fps must be positive"],
    ["a non-positive frames per grid", { framesPerGrid: 0 }, "frames_per_grid must be positive"],
    ["a non-positive resolution", { outputResolution: 0 }, "output_resolution must be positive"],
    ["a jpeg quality below 1", { jpegQuality: 0 }, "jpeg_quality must be between 1 and 100"],
    ["a jpeg quality above 100", { jpegQuality: 101 }, "jpeg_quality must be between 1 and 100"],
    ["a fractional frame count", { frameCount: 2.5 }, "frame_count must be a positive integer"],
    ["a zero frame count", { frameCount: 0 }, "frame_count must be a positive integer"],
    ["a zero keyframe cap", { maxKeyframes: 0 }, "max_keyframes must be a positive integer"],
    ["no explicit timestamps", { timestampsSeconds: [] }, "timestamps_seconds must not be empty"],
    ["a negative timestamp", { timestampsSeconds: [1, -0.1] }, BAD_TIMESTAMPS],
    ["a timestamp that is not a number", { timestampsSeconds: [NaN] }, BAD_TIMESTAMPS],
    ["an infinite timestamp", { timestampsSeconds: [Infinity] }, BAD_TIMESTAMPS],
    [
      "timestamps with keyframe sampling",
      { timestampsSeconds: [1], keyframeSampling: true },
      TIMESTAMPS_COMBINED,
    ],
    [
      "timestamps with a frame count",
      { timestampsSeconds: [1], frameCount: 2 },
      TIMESTAMPS_COMBINED,
    ],
    [
      "timestamps with a keyframe cap",
      { timestampsSeconds: [1], maxKeyframes: 2 },
      TIMESTAMPS_COMBINED,
    ],
    ["an area starting outside the picture", { area: { ...WHOLE_PICTURE, left: -1 } }, BAD_AREA],
    ["an area ending outside the picture", { area: { ...WHOLE_PICTURE, bottom: 1001 } }, BAD_AREA],
    ["an area side that is not a number", { area: { ...WHOLE_PICTURE, top: NaN } }, BAD_AREA],
    [
      "an area with no width",
      { area: { ...WHOLE_PICTURE, left: 1000 } },
      "area's left must be less than its right",
    ],
    [
      "an upside down area",
      { area: { ...WHOLE_PICTURE, top: 600, bottom: 400 } },
      "area's top must be less than its bottom",
    ],
    [
      "an unknown transcript scope",
      { transcript: UNKNOWN_SCOPE },
      "transcript_scope must be per-sheet or combined",
    ],
  ])("rejects %s with an invalid_request error", (_case, overrides, message) => {
    const err = validationError(overrides);
    expect(err).toBeInstanceOf(Vid2GridError);
    expect(err).toMatchObject({ code: "invalid_request", message, name: "Vid2GridError" });
  });

  it("reports the range before any later problem", () => {
    expect(validationError({ endSeconds: 0, jpegQuality: 0 })).toMatchObject({
      message: "end_time must be greater than start_time",
    });
  });
});

describe("collagePlanRequestProblem", () => {
  it("names the problem validation would throw, without throwing", () => {
    expect(collagePlanRequestProblem(request())).toBeUndefined();
    expect(collagePlanRequestProblem(request({ jpegQuality: 0 }))).toBe(
      "jpeg_quality must be between 1 and 100",
    );
  });
});

describe("samplingRangeProblem", () => {
  it("is undefined for a range that can be sampled", () => {
    expect(samplingRangeProblem({ startSeconds: 1, endSeconds: 2, targetFps: 1 })).toBeUndefined();
  });

  it("names the same problems validation throws", () => {
    expect(samplingRangeProblem({ startSeconds: 2, endSeconds: 2, targetFps: 1 })).toBe(
      "end_time must be greater than start_time",
    );
    expect(samplingRangeProblem({ startSeconds: 0, endSeconds: 2, targetFps: -1 })).toBe(
      "target_fps must be positive",
    );
  });
});
