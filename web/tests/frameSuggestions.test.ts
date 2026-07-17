import { describe, expect, it } from "vitest";
import {
  countBlankCells,
  countGridPackingBlanks,
  estimateExtractedFrameCount,
  estimateSheetCount,
  suggestFramesPerGrid,
} from "../src/frameSuggestions";

const OUTPUT_RESOLUTION = 1024;
const GUTTER_PX = 8;
const PORTRAIT_ASPECT = 9 / 16;
const SQUARE_ASPECT = 1;

describe("estimateExtractedFrameCount", () => {
  it("matches the extractor's sampling formula", () => {
    expect(estimateExtractedFrameCount(0, 10, 2)).toBe(20);
    expect(estimateExtractedFrameCount(5, 5.4, 1)).toBe(1); // floors up to a minimum of 1
  });

  it("returns 0 for an invalid/empty range", () => {
    expect(estimateExtractedFrameCount(5, 5, 1)).toBe(0);
    expect(estimateExtractedFrameCount(0, 10, 0)).toBe(0);
  });

  it("drops the trailing sample that the real extractor would also skip", () => {
    // endTime == the video's full duration: a naive floor(duration*fps) predicts
    // 10 samples (0,1,...,9s), but the 10th sample's timestamp (9s) lands right at
    // video.duration, which extractFrames' `timestamp >= video.duration` check
    // would skip - so the estimate must drop it too once duration is known.
    expect(estimateExtractedFrameCount(0, 10, 1)).toBe(10); // no video duration given: naive
    expect(estimateExtractedFrameCount(0, 10, 1, 9)).toBe(9); // real duration is only 9s
  });

  it("matches extractFrames when the last sample lands before the real duration", () => {
    expect(estimateExtractedFrameCount(0, 10, 1, 10.5)).toBe(10);
  });
});

describe("countBlankCells", () => {
  it("is 0 when framesPerGrid evenly divides the total", () => {
    expect(countBlankCells(100, 10)).toBe(0);
  });

  it("is the gap to the next full sheet otherwise", () => {
    expect(countBlankCells(10, 4)).toBe(2); // 3 sheets of 4 -> last sheet has 2 real + 2 blank
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

describe("countGridPackingBlanks", () => {
  it("is 0 when framesPerGrid exactly fills its packed rectangle", () => {
    // 6 frames at a square aspect packs into a perfect 3x2 (or 2x3) rectangle.
    expect(countGridPackingBlanks(6, SQUARE_ASPECT, OUTPUT_RESOLUTION, GUTTER_PX)).toBe(0);
  });

  it("counts leftover cells in the packed rectangle for a portrait source", () => {
    // 5 portrait frames pack into a 3x2 = 6-cell rectangle -> 1 wasted cell,
    // reproducing the bug where every grid showed a black cell despite the
    // old trailing-remainder check reporting "no blank cells".
    expect(countGridPackingBlanks(5, PORTRAIT_ASPECT, OUTPUT_RESOLUTION, GUTTER_PX)).toBe(1);
  });

  it("returns null for an invalid framesPerGrid", () => {
    expect(countGridPackingBlanks(0, SQUARE_ASPECT, OUTPUT_RESOLUTION, GUTTER_PX)).toBeNull();
  });
});

describe("suggestFramesPerGrid", () => {
  it("prefers values with fewer wasted cells in the packed rectangle", () => {
    const suggestions = suggestFramesPerGrid(100, 5, PORTRAIT_ASPECT, OUTPUT_RESOLUTION, GUTTER_PX);

    // 4 and 6 both pack into a perfect rectangle for this aspect and are
    // equally close to 5; either is an acceptable top pick.
    expect(suggestions[0].wastedCells).toBe(0);
    expect([4, 6]).toContain(suggestions[0].framesPerGrid);
  });

  it("returns nothing when there's no video/invalid state", () => {
    expect(suggestFramesPerGrid(0, 9, SQUARE_ASPECT, OUTPUT_RESOLUTION, GUTTER_PX)).toEqual([]);
    expect(suggestFramesPerGrid(100, 0, SQUARE_ASPECT, OUTPUT_RESOLUTION, GUTTER_PX)).toEqual([]);
  });

  it("never suggests the current value itself", () => {
    const suggestions = suggestFramesPerGrid(100, 9, SQUARE_ASPECT, OUTPUT_RESOLUTION, GUTTER_PX);
    expect(suggestions.some((s) => s.framesPerGrid === 9)).toBe(false);
  });
});
