import type { PlannedCrop, RenderPlan } from "@vid2grid/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFrameTimestamps } from "../src/capture/videoDemuxer";
import type { VideoSample } from "../src/capture/videoSamples";
import { decodeFrames, extractFramesWebCodecs } from "../src/capture/webcodecsExtractor";
import { FakeVideoDecoder, stubWebCodecs, type FakeWebCodecs } from "./fakeVideoDecoder";
import { fixtureBytes, sourceFile } from "./sourceFile";

const bytes = fixtureBytes("keyframes-20s.mp4");
const TIMESCALE = 10;
const CELL = { width: 8, height: 8 };

let webCodecs: FakeWebCodecs;

beforeEach(() => {
  webCodecs = stubWebCodecs();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function decoder(): FakeVideoDecoder {
  const latest = FakeVideoDecoder.instances.at(-1);
  if (!latest) throw new Error("No decoder was created");
  return latest;
}

function planAt(times: readonly number[]): RenderPlan {
  return {
    frames: times.map((timestampSeconds, frameIndex) => ({ frameIndex, timestampSeconds })),
    cell: CELL,
  } as unknown as RenderPlan;
}

async function framesAt(file: File, times: readonly number[], crop?: PlannedCrop) {
  const plan = { ...planAt(times), ...(crop && { crop }) };
  const images = await extractFramesWebCodecs(file, plan);
  if (!images) throw new Error("The fast path declined the fixture");
  return images;
}

async function drain(images: AsyncIterable<ImageBitmap>): Promise<number> {
  let count = 0;
  for await (const image of images) {
    image.close();
    count++;
  }
  return count;
}

const drawnSeconds = () => webCodecs.drawn.map((frame) => frame.timestamp / 1e6);

// Samples one byte long, in decode order.
function track(...cts: { cts: number; is_sync?: boolean }[]) {
  const samples: VideoSample[] = cts.map(({ cts, is_sync = false }, index) => ({
    cts,
    is_sync,
    duration: 1,
    timescale: TIMESCALE,
    offset: index,
    size: 1,
  }));
  const source = sourceFile(new Uint8Array(samples.length));
  return {
    source,
    decodeAt: (wanted: number[], signal?: AbortSignal) =>
      decodeFrames(
        { codec: "avc1" },
        {
          file: source.file,
          samples,
          keyframeIndices: null,
          wanted,
          cell: CELL,
          rotation: 0,
          signal,
        },
      ),
  };
}

const GOP = 40;
const closedGops = Array.from({ length: 400 }, (_, i) => ({ cts: i, is_sync: i % GOP === 0 }));

// Each GOP after the first opens with a sync whose two leading frames need the GOP before it.
function openGopsOf(count: number) {
  return Array.from({ length: count }, (_, gop) => {
    const start = gop * GOP;
    const rest = Array.from({ length: GOP - 3 }, (_, i) => ({ cts: start + i + 1 }));
    const leading = gop === 0 ? [] : [{ cts: start - 2 }, { cts: start - 1 }];
    return [{ cts: start, is_sync: true }, ...leading, ...rest];
  }).flat();
}

const openGops = openGopsOf(10);
// Enough GOPs to run out of patience with syncs the decoder refuses.
const longOpenGops = openGopsOf(20);

// Mini-GOPs of I/P B B B, with a P ahead of the B-frames shown before it.
const bFrames = Array.from({ length: 10 }, (_, gop) => {
  const start = gop * GOP;
  const miniGops = Array.from({ length: GOP / 4 - 1 }, (_, i) => start + 4 * i);
  return [
    { cts: start, is_sync: true },
    ...miniGops.flatMap((from) => [4, 2, 1, 3].map((step) => ({ cts: from + step }))),
    ...[3, 2, 1].map((before) => ({ cts: start + GOP - before })),
  ];
}).flat();

describe("a sparse plan", () => {
  it("picks the frames a decode of everything picks, edit list included", async () => {
    const { file } = sourceFile(bytes);
    const everyFrame = (await readFrameTimestamps(file)) ?? [];
    const plans = [
      [0.05, 9.95, 19.85],
      [0, 0.1, 3.05, 12.4, 19.9],
      [2.31, 2.32, 7.77, 13.01, 13.99, 18],
      Array.from({ length: 7 }, (_, i) => 0.333333 + i * 2.9),
      Array.from({ length: 60 }, (_, i) => 0.05 + i / 3),
    ];
    for (const times of plans) {
      webCodecs.drawn.length = 0;
      expect(await drain(await framesAt(file, times))).toBe(times.length);
      const picked = times.map((time) => everyFrame.find((frame) => frame >= time));
      expect(drawnSeconds()).toEqual([...new Set(picked)]);
    }
  });

  it("reads a small share of a real file's media", async () => {
    const source = sourceFile(bytes);
    await readFrameTimestamps(source.file);
    const demuxedBytes = source.bytesRead();

    await drain(await framesAt(source.file, [0.2, 9.3, 19.1]));

    expect(source.bytesRead() - demuxedBytes).toBeLessThan(bytes.length / 5);
    expect(decoder().decoded.length).toBeLessThan(200 / 10);
  });

  it("crops in every span, a frame that fills several planned times included", async () => {
    const drawImage = vi.spyOn(CanvasRenderingContext2D.prototype, "drawImage");
    const createImageBitmap = vi.spyOn(globalThis, "createImageBitmap");
    const crop = { x: 4, y: 0, width: 4, height: 8, sourceWidth: 16, sourceHeight: 8 };
    const { file } = sourceFile(bytes);

    expect(await drain(await framesAt(file, [0.2, 9.31, 9.33, 19.1], crop))).toBe(4);

    expect(decoder().flushes).toBe(3);
    const wholeThenCrop = [
      [0, 0, 16, 8],
      [4, 0, 4, 8, 0, 0, 8, 8],
    ];
    expect(drawImage.mock.calls.map((call) => call.slice(1))).toEqual(
      [0.2, 9.4, 19.1].flatMap(() => wholeThenCrop),
    );
    const sources = createImageBitmap.mock.calls.map(([source]) => source);
    const canvases = sources.filter((source) => source instanceof HTMLCanvasElement);
    expect(canvases.map(({ width, height }) => [width, height])).toEqual(
      [0.2, 9.4, 19.1].map(() => [8, 8]),
    );
    const copied = sources.filter((source) => !(source instanceof HTMLCanvasElement));
    expect(copied).toHaveLength(1);
    expect(webCodecs.bitmaps).toContain(copied[0]);
  });

  it("reads and decodes only the samples its frames need", async () => {
    const { source, decodeAt } = track(...closedGops);

    expect(await drain(decodeAt([0.1, 16.2, 36.3]))).toBe(3);

    expect(drawnSeconds()).toEqual([0.1, 16.2, 36.3]);
    expect(source.bytesRead()).toBe(2 + 3 + 4);
    expect(decoder().decoded).toHaveLength(source.bytesRead());
    expect(decoder().flushes).toBe(3);
  });

  it("decodes on without a jump across gaps of a GOP or so", async () => {
    const { decodeAt } = track(...closedGops);

    await drain(decodeAt([0.5, 4.5, 8.5]));

    expect(decoder().decoded).toHaveLength(86);
    expect(decoder().flushes).toBe(1);
  });

  it("finds the frames of a variable frame rate", async () => {
    const { decodeAt } = track(
      ...closedGops.map(({ cts, is_sync }) => ({ cts: cts * cts, is_sync })),
    );

    await drain(decodeAt([0.35, 2600.1, 12000.05]));

    expect(drawnSeconds()).toEqual([0.4, 2624.4, 12040.9]);
  });

  it("ends short where the stream ends", async () => {
    const { decodeAt } = track(...closedGops);

    expect(await drain(decodeAt([1, 39.9, 39.95, 50]))).toBe(2);
    expect(drawnSeconds()).toEqual([1, 39.9]);
    expect(decoder().state).toBe("closed");
  });
});

describe("a sparse plan over open GOPs", () => {
  it("never shows a leading frame decoded without its references", async () => {
    const { decodeAt } = track(...openGops);
    const times = [0.2, 11.8, 11.9, 12, 23.9, 35.95];

    expect(await drain(decodeAt(times))).toBe(times.length);

    expect(drawnSeconds()).toEqual([0.2, 11.8, 11.9, 12, 23.9, 36]);
    expect(webCodecs.drawn.some((frame) => frame.isCorrupt)).toBe(false);
  });

  it("passes over the leading frames it decodes on the way to a later one", async () => {
    const { decodeAt } = track(...openGops);

    await drain(decodeAt([0.2, 12.1]));

    expect(drawnSeconds()).toEqual([0.2, 12.1]);
    expect(decoder().frames.some((frame) => frame.isCorrupt)).toBe(true);
  });

  it("starts earlier when the decoder refuses a sync as a key frame", async () => {
    FakeVideoDecoder.refusedKeys = new Set([12e6, 8e6]);
    const { decodeAt } = track(...openGops);

    await drain(decodeAt([0.2, 12.5]));

    expect(drawnSeconds()).toEqual([0.2, 12.5]);
    expect(decoder().decoded).toContain(4e6);
  });

  it("decodes on from the last start accepted once too many syncs are refused", async () => {
    const isLateSync = ({ cts }: { cts: number }) => cts % GOP === 0 && cts > 4 * GOP;
    FakeVideoDecoder.refusedKeys = new Set(
      longOpenGops.filter(isLateSync).map(({ cts }) => cts * 1e5),
    );
    const { decodeAt } = track(...longOpenGops);

    await drain(decodeAt([0.2, 16.5, 70.5, 75.95]));

    expect(drawnSeconds()).toEqual([0.2, 16.5, 70.5, 76]);
    expect(webCodecs.drawn.some((frame) => frame.isCorrupt)).toBe(false);
    expect(decoder().starts).toEqual([0, 16e6, 16e6]);
  });

  it("decodes from the first sample when no sync after it is accepted", async () => {
    FakeVideoDecoder.refusedKeys = new Set(
      longOpenGops.flatMap(({ cts }) => (cts % GOP === 0 && cts > 0 ? [cts * 1e5] : [])),
    );
    const { decodeAt } = track(...longOpenGops);

    await drain(decodeAt([70.5, 75.5]));

    expect(drawnSeconds()).toEqual([70.5, 75.5]);
    expect(decoder().starts).toEqual([0]);
  });

  it("fails only when the first sample itself is refused", async () => {
    FakeVideoDecoder.refusedKeys = new Set(longOpenGops.map(({ cts }) => cts * 1e5));
    const { decodeAt } = track(...longOpenGops);

    await expect(drain(decodeAt([70.5]))).rejects.toMatchObject({ name: "DataError" });
    expect(drawnSeconds()).toEqual([]);
    expect(decoder().state).toBe("closed");
  });
});

describe("a frame the decoder never emits", () => {
  it("gives way to the next one it does", async () => {
    FakeVideoDecoder.neverEmitted = new Set([20.5e6, 20.6e6]);
    const { decodeAt } = track(...closedGops);

    await drain(decodeAt([0.1, 20.5, 35]));

    expect(drawnSeconds()).toEqual([0.1, 20.7, 35]);
  });

  it.each([
    ["a B-frame", [16.1], 16.2],
    ["a reference B-frame", [16.2], 16.3],
    ["a B-frame and the reference after it", [16.1, 16.2], 16.3],
    ["a P-frame", [16.4], 16.5],
    ["a whole mini-GOP", [16.1, 16.2, 16.3, 16.4], 16.5],
  ])("gives way to the next one shown, among B-frames, for %s", async (_kind, lost, next) => {
    FakeVideoDecoder.neverEmitted = new Set(lost.map((seconds) => Math.round(seconds * 1e6)));
    const { decodeAt } = track(...bFrames);

    await drain(decodeAt([0.1, lost[0] ?? 0, 35.1]));

    expect(drawnSeconds()).toEqual([0.1, next, 35.1]);
  });

  it("ends the stream when nothing follows it", async () => {
    FakeVideoDecoder.neverEmitted = new Set([39.9e6]);
    const { decodeAt } = track(...closedGops);

    expect(await drain(decodeAt([0.1, 39.9]))).toBe(1);
    expect(decoder().state).toBe("closed");
  });
});

describe("stopping a sparse plan", () => {
  it("closes the decoder, its frames and the buffered images on early return", async () => {
    const { source, decodeAt } = track(...closedGops);
    const frames = decodeAt([0.1, 16.2, 36.3]);

    const first = await frames.next();
    await frames.return();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(decoder().state).toBe("closed");
    for (const frame of decoder().frames) expect(frame.close).toHaveBeenCalledTimes(1);
    const [handedOver, ...buffered] = webCodecs.bitmaps;
    expect(first.value).toBe(handedOver);
    for (const bitmap of buffered) expect(bitmap.close).toHaveBeenCalledTimes(1);
    const { length } = source.reads;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(source.reads).toHaveLength(length);
  });

  it("closes every frame when decoding fails part way", async () => {
    FakeVideoDecoder.failsAt = 16.1e6;
    const { decodeAt } = track(...closedGops);

    await expect(drain(decodeAt([0.1, 16.2, 36.3]))).rejects.toMatchObject({
      name: "EncodingError",
    });

    expect(drawnSeconds()).toEqual([0.1]);
    for (const frame of decoder().frames) expect(frame.close).toHaveBeenCalledTimes(1);
    for (const bitmap of webCodecs.bitmaps) expect(bitmap.close).toHaveBeenCalledTimes(1);
  });

  it("closes every frame and fails when drawing one does", async () => {
    vi.spyOn(CanvasRenderingContext2D.prototype, "drawImage").mockImplementation(() => {
      throw new Error("draw failed");
    });
    const { decodeAt } = track(...closedGops);

    await expect(drain(decodeAt([16.2]))).rejects.toThrowError("draw failed");

    expect(decoder().state).toBe("closed");
    for (const frame of decoder().frames) expect(frame.close).toHaveBeenCalledTimes(1);
  });

  it("fails when the file can no longer be read", async () => {
    const { source, decodeAt } = track(...closedGops);
    vi.spyOn(source.file, "slice").mockReturnValue({
      arrayBuffer: () => Promise.reject(new Error("unreadable")),
    } as unknown as Blob);

    await expect(drain(decodeAt([0.1]))).rejects.toThrowError("unreadable");
    expect(decoder().state).toBe("closed");
  });
});

describe("aborting a sparse plan", () => {
  const reason = new Error("stopped");
  const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

  it("rejects a pull that is waiting on a read, and reads and decodes no more", async () => {
    const { source, decodeAt } = track(...closedGops);
    const slice = vi.spyOn(source.file, "slice");
    slice.mockReturnValue({ arrayBuffer: () => new Promise(() => undefined) } as unknown as Blob);
    const controller = new AbortController();
    const pulled = decodeAt([0.1, 16.2], controller.signal).next();
    await settle();

    controller.abort(reason);

    await expect(pulled).rejects.toBe(reason);
    await settle();
    expect(decoder().state).toBe("closed");
    expect(decoder().decoded).toEqual([]);
    expect(slice).toHaveBeenCalledTimes(1);
  });

  it("hands over nothing buffered after it, closing the decoder and every frame", async () => {
    const { source, decodeAt } = track(...closedGops);
    const controller = new AbortController();
    const frames = decodeAt([0.1, 0.2, 0.3, 16.2, 36.3], controller.signal);
    await frames.next();

    controller.abort(reason);

    await expect(frames.next()).rejects.toBe(reason);
    expect(decoder().state).toBe("closed");
    for (const frame of decoder().frames) expect(frame.close).toHaveBeenCalledTimes(1);
    const [, ...buffered] = webCodecs.bitmaps;
    expect(buffered.length).toBeGreaterThan(0);
    for (const bitmap of buffered) expect(bitmap.close).toHaveBeenCalledTimes(1);
    const { length } = source.reads;
    await settle();
    expect(source.reads).toHaveLength(length);
  });

  it("starts no decoder when already aborted", async () => {
    const { source, decodeAt } = track(...closedGops);

    await expect(decodeAt([0.1], AbortSignal.abort(reason)).next()).rejects.toBe(reason);
    expect(FakeVideoDecoder.instances).toEqual([]);
    expect(source.reads).toEqual([]);
  });

  it("stops waiting for the demux, which other readers share", async () => {
    const source = sourceFile(bytes);
    const controller = new AbortController();
    const extracting = extractFramesWebCodecs(source.file, planAt([1]), controller.signal);

    controller.abort(reason);

    await expect(extracting).rejects.toBe(reason);
    expect(await readFrameTimestamps(source.file)).toHaveLength(200);
  });

  it("stops listening to the signal once the plan is done", async () => {
    const { decodeAt } = track(...closedGops);
    const { signal } = new AbortController();
    const remove = vi.spyOn(signal, "removeEventListener");
    const add = vi.spyOn(signal, "addEventListener");

    await drain(decodeAt([0.1], signal));

    expect(add).toHaveBeenCalledTimes(1);
    expect(remove.mock.calls).toEqual(add.mock.calls);
  });
});
