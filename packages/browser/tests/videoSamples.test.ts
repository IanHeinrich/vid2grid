import { describe, expect, it } from "vitest";
import {
  frameTimestampsFromSamples,
  keyframeTimestampsFromSamples,
  onPresentationClock,
  selectKeyframeSampleIndices,
  type SyncSample,
} from "../src/capture/videoSamples";

// The 30-tick timescale makes a sample's cts tick equal its frame index.
const TIMESCALE = 30;

function fakeSamples(count: number, gopSize: number): SyncSample[] {
  return Array.from({ length: count }, (_, i) => ({
    is_sync: i % gopSize === 0,
    cts: i,
    timescale: TIMESCALE,
  }));
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
    expect(keyframeTimestampsFromSamples(samples)).toEqual([]);
  });
});

describe("frameTimestampsFromSamples", () => {
  it("returns every sample's composition time, rounded and ascending", () => {
    expect(frameTimestampsFromSamples(fakeSamples(4, 10))).toEqual([0, 0.033333, 0.066667, 0.1]);
  });

  it("orders samples stored in decode order by presentation time", () => {
    const reordered = [0, 2, 1].map((cts) => ({ cts, timescale: TIMESCALE }));
    expect(frameTimestampsFromSamples(reordered)).toEqual([0, 0.033333, 0.066667]);
  });

  it("keeps the uneven gaps of a variable frame rate track", () => {
    const samples = [0, 1, 7, 8].map((cts) => ({ cts, timescale: TIMESCALE }));
    expect(frameTimestampsFromSamples(samples)).toEqual([0, 0.033333, 0.233333, 0.266667]);
  });
});

describe("onPresentationClock", () => {
  const MOVIE_TIMESCALE = 1000;
  const edit = (media_time: number, segment_duration = 1000) => ({
    media_time,
    segment_duration,
    media_rate_integer: 1,
    media_rate_fraction: 0,
  });
  const track = (...edits: ReturnType<typeof edit>[]) => ({
    movie_timescale: MOVIE_TIMESCALE,
    edits,
  });
  const delayed = fakeSamples(12, 10).map((sample) => ({ ...sample, cts: sample.cts + 2 }));

  it("leaves a track with no edit list alone", () => {
    const samples = fakeSamples(4, 10);
    expect(onPresentationClock(samples, { movie_timescale: MOVIE_TIMESCALE })).toEqual(samples);
    expect(onPresentationClock(samples, track(edit(0)))).toEqual(samples);
  });

  it("starts the clock at the edit list's media time, as the browser does", () => {
    const samples = onPresentationClock(delayed, track(edit(2)));
    expect(frameTimestampsFromSamples(samples).slice(0, 4)).toEqual([0, 0.033333, 0.066667, 0.1]);
    expect(keyframeTimestampsFromSamples(samples)).toEqual([0, 0.333333]);
  });

  it("matches a keyframe plan made on the presentation clock", () => {
    const samples = onPresentationClock(delayed, track(edit(2)));
    expect(selectKeyframeSampleIndices(samples, framesAt([0, 0.333333]))).toEqual([0, 10]);
  });

  it("leaves out pre-roll samples the browser never shows", () => {
    const samples = onPresentationClock(fakeSamples(5, 10), track(edit(2)));
    expect(frameTimestampsFromSamples(samples)).toEqual([0, 0.033333, 0.066667]);
    expect(keyframeTimestampsFromSamples(samples)).toEqual([]);
  });

  it("delays the frames by a leading empty edit", () => {
    const samples = onPresentationClock(fakeSamples(3, 10), track(edit(-1, 500), edit(0)));
    expect(frameTimestampsFromSamples(samples)).toEqual([0.5, 0.533333, 0.566667]);
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
