import { describe, expect, it } from "vitest";
import { Vid2GridError } from "../src/errors";
import { sourceAspect } from "../src/probe/videoInfo";

describe("sourceAspect", () => {
  it("divides display width by display height", () => {
    expect(sourceAspect({ width: 1920, height: 1080 })).toBeCloseTo(16 / 9);
    expect(sourceAspect({ width: 1080, height: 1920 })).toBeCloseTo(9 / 16);
  });

  it.each([
    { width: 0, height: 1080 },
    { width: 1920, height: 0 },
    { width: -1, height: 1080 },
    { width: Number.NaN, height: 1080 },
  ])("rejects non-positive dimensions %o", (dimensions) => {
    expect(() => sourceAspect(dimensions)).toThrowError(Vid2GridError);
    expect(() => sourceAspect(dimensions)).toThrowError("sourceAspect must be positive");
  });
});
