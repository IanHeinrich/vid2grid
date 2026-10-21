import { describe, expect, it } from "vitest";
import { GUTTER_PX, type GridParams } from "../src/grid/gridMaths";
import {
  countGridPackingBlanks,
  estimateExtractedFrameCount,
  estimateSheetCount,
  isKeyframeDense,
  KEYFRAME_DENSE_PER_SECOND,
  keyframesPerSecond,
  suggestFramesPerGrid,
} from "../src/plan/frameSuggestions";

const OUTPUT_RESOLUTION = 1024;
const PORTRAIT: GridParams = {
  sourceAspect: 9 / 16,
  outputResolution: OUTPUT_RESOLUTION,
  gutterPx: GUTTER_PX,
};
const SQUARE: GridParams = {
  sourceAspect: 1,
  outputResolution: OUTPUT_RESOLUTION,
  gutterPx: GUTTER_PX,
};

const range = (startSeconds: number, endSeconds: number, targetFps: number) => ({
  startSeconds,
  endSeconds,
  targetFps,
});

describe("estimateExtractedFrameCount", () => {
  it("matches the planner's sampling formula", () => {
    expect(estimateExtractedFrameCount(range(0, 10, 2))).toBe(20);
    expect(estimateExtractedFrameCount(range(5, 5.4, 1))).toBe(1); // floors up to a minimum of 1
  });

  it("returns 0 for an invalid/empty range", () => {
    expect(estimateExtractedFrameCount(range(5, 5, 1))).toBe(0);
    expect(estimateExtractedFrameCount(range(0, 10, 0))).toBe(0);
  });

  it("drops the trailing sample that the planner would also skip", () => {
    // endSeconds == the video's full duration: a naive floor(duration*fps) predicts
    // 10 samples (0,1,...,9s), but the 10th sample's timestamp (9s) lands right at
    // the real duration, which the planner's `timestamp >= durationSeconds` check
    // skips - so the estimate must drop it too once duration is known.
    expect(estimateExtractedFrameCount(range(0, 10, 1))).toBe(10); // no video duration given: naive
    expect(estimateExtractedFrameCount({ ...range(0, 10, 1), durationSeconds: 9 })).toBe(9);
  });

  it("matches the planner when the last sample lands before the real duration", () => {
    expect(estimateExtractedFrameCount({ ...range(0, 10, 1), durationSeconds: 10.5 })).toBe(10);
  });

  it("honours an explicit frame count instead of the target FPS", () => {
    // frameCount spreads that many frames over the range, so a 10s range at 2fps
    // yields 3, not 20.
    expect(
      estimateExtractedFrameCount({ ...range(0, 10, 2), durationSeconds: 10.5, frameCount: 3 }),
    ).toBe(3);
    // 0s and 3.333333s fit under 5s
    expect(
      estimateExtractedFrameCount({ ...range(0, 10, 2), durationSeconds: 5, frameCount: 3 }),
    ).toBe(2);
  });
});

describe("estimateSheetCount", () => {
  it("rounds up to a whole number of sheets", () => {
    expect(estimateSheetCount(10, 4)).toBe(3);
    expect(estimateSheetCount(100, 10)).toBe(10);
  });

  it("is 0 for an invalid/empty state", () => {
    expect(estimateSheetCount(0, 9)).toBe(0);
    expect(estimateSheetCount(100, 0)).toBe(0);
  });
});

describe("keyframe density", () => {
  it("divides the keyframe count by the range length", () => {
    expect(keyframesPerSecond(30, 10)).toBe(3);
    expect(keyframesPerSecond(5, 0)).toBe(0);
  });

  it("is dense from the threshold upward, not a moment before", () => {
    expect(KEYFRAME_DENSE_PER_SECOND).toBe(2);
    expect(isKeyframeDense(20, 10)).toBe(true);
    expect(isKeyframeDense(19, 10)).toBe(false);
    expect(isKeyframeDense(3, 0)).toBe(false);
  });
});

describe("countGridPackingBlanks", () => {
  it("is 0 when framesPerGrid exactly fills its packed rectangle", () => {
    // 6 frames at a square aspect packs into a perfect 3x2 (or 2x3) rectangle.
    expect(countGridPackingBlanks(6, SQUARE)).toBe(0);
  });

  it("counts leftover cells in the packed rectangle for a portrait source", () => {
    // 5 portrait frames pack into a 3x2 = 6-cell rectangle -> 1 wasted cell,
    // reproducing the bug where every grid showed a black cell despite the
    // old trailing-remainder check reporting "no blank cells".
    expect(countGridPackingBlanks(5, PORTRAIT)).toBe(1);
  });

  it("returns null for an invalid framesPerGrid", () => {
    expect(countGridPackingBlanks(0, SQUARE)).toBeNull();
  });

  it("returns null when the grid cannot be packed at all", () => {
    expect(countGridPackingBlanks(9, { ...SQUARE, outputResolution: 4 })).toBeNull();
    expect(countGridPackingBlanks(9, { ...SQUARE, sourceAspect: 0 })).toBeNull();
  });

  it("rethrows anything other than an invalid grid", () => {
    const hostile = {
      ...SQUARE,
      get sourceAspect(): number {
        throw new TypeError("boom");
      },
    };
    expect(() => countGridPackingBlanks(9, hostile)).toThrowError(TypeError);
  });
});

describe("suggestFramesPerGrid", () => {
  it("prefers values with fewer wasted cells in the packed rectangle", () => {
    const suggestions = suggestFramesPerGrid({ totalFrames: 100, currentValue: 5, grid: PORTRAIT });

    // 4 and 6 both pack into a perfect rectangle for this aspect and are
    // equally close to 5; either is an acceptable top pick.
    expect(suggestions[0]?.wastedCells).toBe(0);
    expect([4, 6]).toContain(suggestions[0]?.framesPerGrid);
  });

  it("reports how many sheets each suggestion would make", () => {
    const suggestions = suggestFramesPerGrid({ totalFrames: 100, currentValue: 5, grid: PORTRAIT });
    for (const suggestion of suggestions) {
      expect(suggestion.sheets).toBe(estimateSheetCount(100, suggestion.framesPerGrid));
    }
  });

  it("returns nothing when there's no video/invalid state", () => {
    expect(suggestFramesPerGrid({ totalFrames: 0, currentValue: 9, grid: SQUARE })).toEqual([]);
    expect(suggestFramesPerGrid({ totalFrames: 100, currentValue: 0, grid: SQUARE })).toEqual([]);
  });

  it("never suggests the current value itself", () => {
    const suggestions = suggestFramesPerGrid({ totalFrames: 100, currentValue: 9, grid: SQUARE });
    expect(suggestions.some((s) => s.framesPerGrid === 9)).toBe(false);
  });

  it("honours the search radius and suggestion cap", () => {
    const suggestions = suggestFramesPerGrid({
      totalFrames: 100,
      currentValue: 9,
      grid: SQUARE,
      searchRadius: 2,
      maxSuggestions: 3,
    });
    expect(suggestions).toHaveLength(3);
    for (const suggestion of suggestions) {
      expect(Math.abs(suggestion.framesPerGrid - 9)).toBeLessThanOrEqual(2);
    }
  });
});
