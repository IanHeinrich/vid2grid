import { describe, expect, it } from "vitest";
import {
  keyframeTimestampsFromSamples,
  planIndicesForFrame,
  selectKeyframeSampleIndices,
} from "../src/extraction/webcodecsExtractor";
import type { Sample } from "mp4box";

// jsdom has no VideoDecoder, so only these pure helpers of the fast path can be tested here.
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

// Which decoded frame ends up in each planned slot, the way both decode paths fold
// the helper over the frames the decoder emits.
function assignDecodedFrames(wanted: number[], decoded: number[]): (number | undefined)[] {
  const filledBy: (number | undefined)[] = new Array(wanted.length);
  let nextIndex = 0;
  decoded.forEach((timestampSeconds, decodedIndex) => {
    for (const index of planIndicesForFrame(wanted, nextIndex, timestampSeconds)) {
      filledBy[index] = decodedIndex;
      nextIndex = index + 1;
    }
  });
  return filledBy;
}

describe("planIndicesForFrame", () => {
  const wanted = [0, 0.333333, 0.666667];

  it("puts each decoded keyframe in the slot its own timestamp asked for", () => {
    expect(assignDecodedFrames(wanted, wanted)).toEqual([0, 1, 2]);
  });

  it("keeps a dropped keyframe from shifting the ones after it", () => {
    // The decoder never emitted 0.333333: the 0.666667 frame still lands in slot 2.
    expect(assignDecodedFrames(wanted, [0, 0.666667])).toEqual([0, 1, 1]);
  });

  it("fills nothing with a frame before the next wanted timestamp, or once all are filled", () => {
    expect(planIndicesForFrame(wanted, 1, 0.25)).toEqual([]);
    expect(planIndicesForFrame(wanted, 3, 9)).toEqual([]);
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
