import { describe, expect, it } from "vitest";
import { floorToTenth, initialRange, MIN_RANGE_GAP, scrubbedRange } from "../src/timeRange";

describe("floorToTenth", () => {
  it("floors to one decimal place", () => {
    expect(floorToTenth(12.99)).toBe(12.9);
  });
});

describe("initialRange", () => {
  it("selects the whole video, floored to a tenth", () => {
    expect(initialRange(12.99)).toEqual({ start: 0, end: 12.9 });
  });

  it("keeps a minimum gap for a very short video", () => {
    expect(initialRange(0.04)).toEqual({ start: 0, end: MIN_RANGE_GAP });
  });
});

describe("scrubbedRange", () => {
  const current = { start: 2, end: 8 };

  it("moves the start handle and leaves the end alone", () => {
    expect(scrubbedRange("start", 3.04, current, 10)).toEqual({ start: 3, end: 8 });
  });

  it("stops the start handle one gap short of the end", () => {
    expect(scrubbedRange("start", 9, current, 10)).toEqual({ start: 7.9, end: 8 });
  });

  it("clamps the start handle at zero", () => {
    expect(scrubbedRange("start", -1, current, 10)).toEqual({ start: 0, end: 8 });
  });

  it("stops the end handle one gap past the start", () => {
    expect(scrubbedRange("end", 1, current, 10)).toEqual({ start: 2, end: 2.1 });
  });

  it("clamps the end handle at the duration", () => {
    expect(scrubbedRange("end", 15, current, 10)).toEqual({ start: 2, end: 10 });
  });
});
