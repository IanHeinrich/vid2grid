import { describe, expect, it } from "vitest";
import {
  byteRuns,
  presentationOffsetSeconds,
  samplesForRange,
  trimToRange,
  type StoredSample,
} from "../src/capture/audioRange";

// Ten samples of 0.1 s each, stored back to back except for a gap after the fifth.
const SAMPLES: StoredSample[] = Array.from({ length: 10 }, (_, index) => ({
  cts: index * 100,
  duration: 100,
  timescale: 1000,
  offset: 1000 + index * 4 + (index >= 5 ? 50 : 0),
  size: 4,
}));

describe("presentationOffsetSeconds", () => {
  it("shifts by an empty edit and back by the first edit's media time", () => {
    const edits = [
      { segment_duration: 500, media_time: -1, media_rate_integer: 1, media_rate_fraction: 0 },
      { segment_duration: 9000, media_time: 2048, media_rate_integer: 1, media_rate_fraction: 0 },
    ];

    expect(presentationOffsetSeconds(edits, 1000, 48000)).toBeCloseTo(0.5 - 2048 / 48000, 10);
  });

  it("leaves a track without a media edit where it is", () => {
    expect(presentationOffsetSeconds(undefined, 1000, 48000)).toBe(0);
    const emptyOnly = [
      { segment_duration: 500, media_time: -1, media_rate_integer: 1, media_rate_fraction: 0 },
    ];
    expect(presentationOffsetSeconds(emptyOnly, 1000, 48000)).toBe(0);
  });
});

describe("samplesForRange", () => {
  it("takes the samples overlapping the range plus the pre-roll before it", () => {
    expect(samplesForRange(SAMPLES, 0, 0.25, 0.65)).toEqual({ first: 1, end: 7 });
  });

  it("runs to the last sample for an open-ended range", () => {
    expect(samplesForRange(SAMPLES, 0, 0.5, Number.POSITIVE_INFINITY)).toEqual({
      first: 4,
      end: 10,
    });
  });

  it("applies the timeline offset to every sample", () => {
    expect(samplesForRange(SAMPLES, 0.5, 0.5, 0.7, 0)).toEqual({ first: 0, end: 2 });
  });

  it("finds nothing past the end or in an empty range", () => {
    expect(samplesForRange(SAMPLES, 0, 5, 6)).toBeNull();
    expect(samplesForRange(SAMPLES, 0, 0.5, 0.5, 0)).toBeNull();
  });
});

describe("byteRuns", () => {
  it("joins samples stored back to back and splits at a gap", () => {
    expect(byteRuns(SAMPLES, { first: 2, end: 8 }, 1024)).toEqual([
      { offset: 1008, length: 12, first: 2, end: 5 },
      { offset: 1070, length: 12, first: 5, end: 8 },
    ]);
  });

  it("starts a new read once a run would pass the byte limit", () => {
    expect(byteRuns(SAMPLES, { first: 0, end: 3 }, 8).map((run) => run.length)).toEqual([8, 4]);
  });
});

describe("trimToRange", () => {
  const samples = Float32Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);

  it("cuts decoded audio that starts early down to the range", () => {
    expect(Array.from(trimToRange(samples, 10, 0, 0.3, 0.6))).toEqual([3, 4, 5]);
  });

  it("pads with silence where the audio starts after the range does", () => {
    expect(Array.from(trimToRange(samples, 10, 0.2, 0, 0.5))).toEqual([0, 0, 0, 1, 2]);
  });

  it("pads with silence past the end of the audio", () => {
    expect(Array.from(trimToRange(samples, 10, 0, 0.8, 1.2))).toEqual([8, 9, 0, 0]);
  });

  it("gives silence when the audio starts after the range ends", () => {
    expect(Array.from(trimToRange(samples, 10, 2, 0, 0.3))).toEqual([0, 0, 0]);
  });
});
