import { describe, expect, it } from "vitest";
import { createSpanPlanner, type SpanPlanner } from "../src/capture/decodeSpans";
import type { SyncSample } from "../src/capture/videoSamples";

// A timescale of 10 makes a sample's cts ten times its seconds.
const TIMESCALE = 10;
const GOP = 20;

const sample = (cts: number, is_sync = false): SyncSample => ({
  cts,
  is_sync,
  timescale: TIMESCALE,
});

const closedGops = Array.from({ length: 200 }, (_, i) => sample(i, i % GOP === 0));

// Each later GOP stores its sync before the two B-frames shown ahead of it: I0 P3 B1 B2 I6 B4 B5...
const openGops = [
  sample(0, true),
  ...[3, 1, 2].map((cts) => sample(cts)),
  ...[sample(6, true), sample(4), sample(5), sample(9), sample(7), sample(8)],
  ...[sample(12, true), sample(10), sample(11), sample(15), sample(13), sample(14)],
];

function spansOf(planner: SpanPlanner, plannedCounts: number[]): (number[] | null)[] {
  return plannedCounts.map((plannedIndex) => {
    const span = planner.next(plannedIndex);
    return span && [span.first, span.last];
  });
}

describe("createSpanPlanner", () => {
  it("decodes from the sync before a frame to that frame, and no further", () => {
    expect(spansOf(createSpanPlanner(closedGops, [4.5]), [0])).toEqual([[40, 45]]);
  });

  it("takes the first frame at or after a time, rounded to microseconds", () => {
    const thirds = [0, 1, 2].map((cts) => ({ cts, is_sync: cts === 0, timescale: 3 }));
    expect(spansOf(createSpanPlanner(thirds, [0.333333]), [0])).toEqual([[0, 1]]);
    expect(spansOf(createSpanPlanner(thirds, [0.333334]), [0])).toEqual([[0, 2]]);
  });

  it("carries straight on while the next sync is the following one", () => {
    expect(spansOf(createSpanPlanner(closedGops, [0.5, 3.9, 5]), [0])).toEqual([[0, 50]]);
  });

  it("jumps once a whole GOP would be decoded for nothing", () => {
    const planner = createSpanPlanner(closedGops, [0.5, 4.1, 4.2, 12.5]);
    expect(spansOf(planner, [0, 1, 3])).toEqual([
      [0, 5],
      [40, 42],
      [120, 125],
    ]);
  });

  it("decodes through gaps of a few frames even when every frame is a sync", () => {
    const allSync = Array.from({ length: 100 }, (_, i) => sample(i, true));
    expect(spansOf(createSpanPlanner(allSync, [0, 1, 2]), [0])).toEqual([[0, 20]]);
    expect(spansOf(createSpanPlanner(allSync, [0, 5]), [0, 1])).toEqual([
      [0, 0],
      [50, 50],
    ]);
  });

  it("finds frames of a variable frame rate by their times", () => {
    const uneven = [0, 1, 50, 51, 300].map((cts, i) => sample(cts, i === 0 || i === 4));
    const planner = createSpanPlanner(uneven, [0.15, 5.05, 12]);
    expect(spansOf(planner, [0, 1, 2])).toEqual([
      [0, 4],
      [0, 4],
      [4, 4],
    ]);
  });

  it("ends with the stream", () => {
    const planner = createSpanPlanner(closedGops, [19.9, 19.95]);
    expect(spansOf(planner, [0, 1, 2])).toEqual([[180, 199], null, null]);
  });
});

describe("createSpanPlanner with open GOPs", () => {
  it("starts a leading frame from the GOP before its sync", () => {
    expect(spansOf(createSpanPlanner(openGops, [1]), [0])).toEqual([[4, 12]]);
  });

  it("starts a trailing frame from its own sync", () => {
    expect(spansOf(createSpanPlanner(openGops, [1.3]), [0])).toEqual([[10, 15]]);
  });

  it("starts frames leading the first sync from it, having nothing earlier", () => {
    const cutOpen = [sample(2, true), sample(0), sample(1), sample(3)];
    expect(spansOf(createSpanPlanner(cutOpen, [0]), [0])).toEqual([[0, 2]]);
  });

  it("starts from an earlier sync once one is rejected, down to the first sample", () => {
    const planner = createSpanPlanner(openGops, [1.3]);
    planner.rejectSync(10);
    expect(spansOf(planner, [0])).toEqual([[4, 15]]);
    planner.rejectSync(4);
    planner.rejectSync(0);
    expect(spansOf(planner, [0])).toEqual([[0, 15]]);
  });

  it("neither starts at nor jumps to unproven syncs once told to stop trying them", () => {
    const planner = createSpanPlanner(closedGops, [4.5, 12.5, 17.5]);
    expect(spansOf(planner, [0, 1])).toEqual([
      [40, 45],
      [120, 125],
    ]);
    planner.acceptSync(40);
    planner.stopTryingSyncs();
    expect(spansOf(planner, [1])).toEqual([[40, 175]]);
  });
});

// Decode order of a B-frame pyramid: each P ahead of the B-frames shown before it.
const pyramid = [0, 4, 2, 1, 3, 8, 6, 5, 7, 12, 10, 9, 11].map((cts) => sample(cts, cts === 0));

describe("createSpanPlanner with B-frames", () => {
  it.each([
    ["a B-frame", 0.1, 4],
    ["a reference B-frame", 0.2, 4],
    ["a P-frame with none shown after it yet", 0.4, 1],
    ["a later B-frame", 0.5, 8],
  ])("ends past every frame shown up to the latest one decoded, for %s", (_kind, time, last) => {
    expect(spansOf(createSpanPlanner(pyramid, [time]), [0])).toEqual([[0, last]]);
  });

  it("extends to a point where the same holds", () => {
    const planner = createSpanPlanner(pyramid, [0.4]);
    expect(planner.next(0, 4)).toEqual({ first: 0, last: 8 });
    expect(planner.next(0, 100)).toEqual({ first: 0, last: pyramid.length - 1 });
  });
});
