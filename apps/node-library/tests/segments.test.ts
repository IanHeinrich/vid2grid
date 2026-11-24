import { describe, expect, it } from "vitest";
import { seeksToTry, splitIntoSegments } from "../src/segments";

// Landings in a stream with a keyframe every gopSeconds.
function landingsEvery(gopSeconds: number, planned: number[]): Map<number, number> {
  const seeks = seeksToTry(planned);
  return new Map(seeks.map((seek) => [seek, Math.floor(seek / gopSeconds) * gopSeconds]));
}

describe("seeksToTry", () => {
  it("tries nothing for a dense plan", () => {
    expect(seeksToTry([0, 1, 2, 3, 4])).toEqual([]);
  });

  it("tries each far time, and a little before it", () => {
    expect(seeksToTry([600, 601, 620, 624, 700])).toEqual([620, 619, 700, 699]);
  });
});

describe("splitIntoSegments", () => {
  it("has no segments for a plan with no frames", () => {
    expect(splitIntoSegments([], new Map())).toEqual([]);
  });

  it("starts a segment at each far time", () => {
    const planned = [0, 1, 60, 61, 120];
    expect(splitIntoSegments(planned, landingsEvery(2, planned))).toEqual([
      { seekSeconds: 0, plannedSeconds: [0, 1] },
      { seekSeconds: 60, plannedSeconds: [60, 61] },
      { seekSeconds: 120, plannedSeconds: [120] },
    ]);
  });

  it("decodes through when the keyframe is too close to the time before", () => {
    const planned = [0, 12, 24, 36];
    expect(splitIntoSegments(planned, landingsEvery(30, planned))).toEqual([
      { seekSeconds: 0, plannedSeconds: [0, 12, 24] },
      { seekSeconds: 36, plannedSeconds: [36] },
    ]);
  });

  it("decodes through when no seek found a keyframe", () => {
    expect(splitIntoSegments([0, 60, 120], new Map())).toEqual([
      { seekSeconds: 0, plannedSeconds: [0, 60, 120] },
    ]);
  });

  it("seeks earlier when the first seek lands after the planned time", () => {
    const landings = new Map([
      [60, 60.07],
      [59, 58.07],
    ]);
    expect(splitIntoSegments([0, 60], landings)).toEqual([
      { seekSeconds: 0, plannedSeconds: [0] },
      { seekSeconds: 59, plannedSeconds: [60] },
    ]);
  });
});
