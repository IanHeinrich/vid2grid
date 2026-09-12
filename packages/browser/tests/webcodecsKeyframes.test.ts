import { describe, expect, it } from "vitest";
import {
  keyframeTimestampsFromSamples,
  selectKeyframeSampleIndices,
} from "../src/extraction/webcodecsExtractor";
import type { Sample } from "mp4box";

// The keyframe helpers are the only part of the WebCodecs path that can run
// under jsdom (VideoDecoder is unavailable), so they are covered directly with
// fabricated sample tables. A 30-tick/second timescale makes a sample's cts
// tick equal its frame index.
const TIMESCALE = 30;

function fakeSamples(count: number, gopSize: number): Sample[] {
  return Array.from({ length: count }, (_, i) => ({
    is_sync: i % gopSize === 0,
    cts: i,
    dts: i,
    timescale: TIMESCALE,
    duration: 1,
  })) as unknown as Sample[];
}

const framesAt = (timestamps: number[]) =>
  timestamps.map((timestampSeconds, frameIndex) => ({ frameIndex, timestampSeconds }));

describe("keyframeTimestampsFromSamples", () => {
  it("returns every sync sample's composition time, rounded and ascending", () => {
    // Keyframes at indices 0, 10, 20 -> 0s, 0.333333s, 0.666667s.
    expect(keyframeTimestampsFromSamples(fakeSamples(30, 10))).toEqual([0, 0.333333, 0.666667]);
  });

  it("returns nothing when the track has no sync samples", () => {
    const samples = fakeSamples(5, 10).map((sample) => ({ ...sample, is_sync: false }));
    expect(keyframeTimestampsFromSamples(samples as unknown as Sample[])).toEqual([]);
  });
});

describe("selectKeyframeSampleIndices", () => {
  const samples = fakeSamples(30, 10);

  it("maps a keyframe-sampled plan onto the sync samples it came from", () => {
    expect(selectKeyframeSampleIndices(samples, framesAt([0, 0.333333, 0.666667]))).toEqual([
      0, 10, 20,
    ]);
    expect(selectKeyframeSampleIndices(samples, framesAt([0.666667]))).toEqual([20]);
  });

  it("refuses a plan whose timestamps are not all keyframes", () => {
    expect(selectKeyframeSampleIndices(samples, framesAt([0, 0.25, 0.666667]))).toBeNull();
    expect(selectKeyframeSampleIndices(samples, framesAt([]))).toBeNull();
  });
});
