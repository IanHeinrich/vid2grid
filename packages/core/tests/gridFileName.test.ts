import { describe, expect, it } from "vitest";
import {
  combinedTranscriptFileName,
  gridFileName,
  gridTranscriptFileName,
} from "../src/plan/gridFileName";

describe("grid file names", () => {
  it("numbers sheets from 1, zero-padded to four digits", () => {
    expect(gridFileName(0)).toBe("grid_0001.jpg");
    expect(gridFileName(41)).toBe("grid_0042.jpg");
    expect(gridFileName(9999)).toBe("grid_10000.jpg");
  });

  it("pairs each sheet's transcript with its image by number", () => {
    expect(gridTranscriptFileName(0)).toBe("grid_0001.vtt");
    expect(gridTranscriptFileName(41)).toBe("grid_0042.vtt");
  });

  it("names the combined transcript", () => {
    expect(combinedTranscriptFileName()).toBe("transcript.vtt");
  });
});
