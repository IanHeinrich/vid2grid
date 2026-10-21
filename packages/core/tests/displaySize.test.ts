import { describe, expect, it } from "vitest";
import {
  displaySize,
  normalizeRotationClockwise,
  type SampleAspectRatio,
} from "../src/probe/displaySize";

const ANAMORPHIC_NTSC: SampleAspectRatio = { numerator: 32, denominator: 27 };

describe("displaySize", () => {
  it.each<[[number, number], SampleAspectRatio | null, number, [number, number]]>([
    [[320, 240], null, 0, [320, 240]],
    [[320, 240], { numerator: 1, denominator: 1 }, 0, [320, 240]],
    [[720, 480], ANAMORPHIC_NTSC, 0, [853, 480]],
    [[720, 480], ANAMORPHIC_NTSC, 90, [480, 853]],
    [[720, 480], ANAMORPHIC_NTSC, 270, [480, 853]],
    [[720, 480], ANAMORPHIC_NTSC, 180, [853, 480]],
    [[320, 240], null, 90, [240, 320]],
  ])("shows %j at SAR %j rotated %i as %j", ([codedW, codedH], ratio, rotation, [w, h]) => {
    expect(displaySize(codedW, codedH, ratio, rotation)).toEqual({ width: w, height: h });
  });

  it("rounds an exact half to even, as Python's round does", () => {
    const half: SampleAspectRatio = { numerator: 1, denominator: 2 };

    expect(displaySize(5, 4, half, 0).width).toBe(2);
    expect(displaySize(7, 4, half, 0).width).toBe(4);
  });
});

describe("normalizeRotationClockwise", () => {
  it.each([
    [0, 0],
    [-90, 90],
    [90, 270],
    [180, 180],
    [-180, 180],
    [270, 90],
    [-270, 270],
    [360, 0],
    [-89.9, 90],
    [-0.4, 0],
  ])("turns %f degrees counter-clockwise into %i clockwise", (ccwDegrees, expected) => {
    expect(normalizeRotationClockwise(ccwDegrees)).toBe(expected);
  });
});
