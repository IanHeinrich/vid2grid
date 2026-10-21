import { describe, expect, it } from "vitest";
import { resolveKeyframeSampling } from "../src/plan/keyframeFallback";
import type { CollagePlanRequest } from "../src/plan/request";
import type { VideoInfo } from "../src/probe/videoInfo";

const INFO: VideoInfo = { durationSeconds: 10, width: 640, height: 480 };
const KEYFRAME_REQUEST: CollagePlanRequest = {
  startSeconds: 2,
  endSeconds: 4,
  targetFps: 1,
  keyframeSampling: true,
  framesPerGrid: 4,
  outputResolution: 512,
  jpegQuality: 85,
};

describe("resolveKeyframeSampling", () => {
  it("leaves a sampled request alone", () => {
    const request = { ...KEYFRAME_REQUEST, keyframeSampling: false };

    expect(resolveKeyframeSampling(request, INFO)).toEqual({ request });
  });

  it("keeps keyframe sampling when a keyframe falls inside the range, ends included", () => {
    const info = { ...INFO, keyframeTimestampsSeconds: [0, 4, 8] };

    expect(resolveKeyframeSampling(KEYFRAME_REQUEST, info)).toEqual({ request: KEYFRAME_REQUEST });
  });

  it("falls back to target FPS with a warning when the info has no keyframe times", () => {
    expect(resolveKeyframeSampling(KEYFRAME_REQUEST, INFO)).toEqual({
      request: { ...KEYFRAME_REQUEST, keyframeSampling: false },
      warning: {
        code: "keyframes_unavailable",
        message: "Keyframes unavailable; sampled by target FPS instead",
      },
    });
  });

  it("falls back when every keyframe lies outside the range", () => {
    const info = { ...INFO, keyframeTimestampsSeconds: [0, 1.999, 4.001] };

    expect(resolveKeyframeSampling(KEYFRAME_REQUEST, info).request.keyframeSampling).toBe(false);
  });

  it("names the reason keyframe times could not be read", () => {
    const { warning } = resolveKeyframeSampling(KEYFRAME_REQUEST, INFO, "moov box truncated");

    expect(warning?.message).toBe(
      "Keyframes unavailable (moov box truncated); sampled by target FPS instead",
    );
  });
});
