import { describe, expect, it } from "vitest";
import { selectKeyframeIndices } from "../src/extraction/webcodecsExtractor";
import type { Sample } from "mp4box";

// jsdom has no VideoDecoder, so only this pure part of the fast path can be tested here.
// The 30-tick timescale makes a sample's cts tick equal its frame index.
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

describe("selectKeyframeIndices", () => {
  it("returns every keyframe whose time falls in the range", () => {
    const samples = fakeSamples(30, 10); // keyframes at indices 0, 10, 20 -> 0s, 0.333s, 0.667s
    expect(selectKeyframeIndices(samples, 0, 1)).toEqual([0, 10, 20]);
  });

  it("excludes keyframes outside [startTime, endTime]", () => {
    const samples = fakeSamples(30, 10);
    // Only keyframes at >= 0.4s: index 20 (0.667s).
    expect(selectKeyframeIndices(samples, 0.4, 1)).toEqual([20]);
    // Only keyframes at <= 0.5s: indices 0 (0s) and 10 (0.333s).
    expect(selectKeyframeIndices(samples, 0, 0.5)).toEqual([0, 10]);
  });

  it("returns only sync samples, ascending and unique", () => {
    const samples = fakeSamples(30, 10);
    const selected = selectKeyframeIndices(samples, 0, 1);

    for (const index of selected) {
      expect(samples[index].is_sync).toBe(true);
    }
    expect([...selected]).toEqual([...selected].sort((a, b) => a - b));
    expect(new Set(selected).size).toBe(selected.length);
  });

  it("returns an empty list when no keyframe falls in the range", () => {
    const samples = fakeSamples(30, 10); // keyframes only at 0s, 0.333s, 0.667s
    expect(selectKeyframeIndices(samples, 0.9, 0.95)).toEqual([]);
  });
});
