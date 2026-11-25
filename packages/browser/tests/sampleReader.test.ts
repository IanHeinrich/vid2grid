import { describe, expect, it } from "vitest";
import { MAX_READ_BYTES } from "../src/capture/fileBytes";
import { readSamples, sampleRuns } from "../src/capture/sampleReader";
import type { VideoSample } from "../src/capture/videoSamples";
import { sourceFile } from "./sourceFile";

const stored = (offset: number, size: number): VideoSample => ({
  cts: 0,
  duration: 1,
  timescale: 1,
  is_sync: true,
  offset,
  size,
});

const runsOf = (...samples: VideoSample[]) =>
  [...sampleRuns(samples)].map((run) => [run.offset, run.length, run.samples.length]);

describe("sampleRuns", () => {
  it("joins samples stored back to back or with a little audio between", () => {
    expect(runsOf(stored(100, 10), stored(110, 10), stored(1000, 10))).toEqual([[100, 910, 3]]);
  });

  it("starts a new run past a large gap or a step back in the file", () => {
    expect(runsOf(stored(100, 10), stored(1e6, 10), stored(50, 10))).toEqual([
      [100, 10, 1],
      [1e6, 10, 1],
      [50, 10, 1],
    ]);
  });

  it("bounds a run, though never below one sample", () => {
    const half = MAX_READ_BYTES / 2;
    const huge = MAX_READ_BYTES * 2;
    expect(runsOf(stored(0, half), stored(half, half), stored(2 * half, huge))).toEqual([
      [0, MAX_READ_BYTES, 2],
      [MAX_READ_BYTES, huge, 1],
    ]);
  });
});

describe("readSamples", () => {
  it("reads a run once and hands out each sample's own bytes", async () => {
    const source = sourceFile(Uint8Array.from({ length: 64 }, (_, i) => i));
    const read: number[][] = [];

    for await (const { data } of readSamples(source.file, [stored(8, 2), stored(20, 3)])) {
      read.push([...data]);
    }

    expect(read).toEqual([
      [8, 9],
      [20, 21, 22],
    ]);
    expect(source.reads).toEqual([{ offset: 8, length: 15 }]);
  });

  it("reads nothing further once the consumer stops", async () => {
    const source = sourceFile(new Uint8Array(1e6));
    const samples = readSamples(source.file, [stored(0, 2), stored(5e5, 2)]);

    await samples.next();
    await samples.return();

    expect(source.reads).toHaveLength(1);
  });
});
