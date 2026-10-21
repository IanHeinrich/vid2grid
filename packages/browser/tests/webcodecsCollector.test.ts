import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFrameCollector } from "../src/capture/webcodecsExtractor";

interface FakeBitmap {
  close: ReturnType<typeof vi.fn>;
}

let bitmaps: FakeBitmap[];
let pendingBitmaps: ((bitmap: FakeBitmap) => void)[];

const ctx = { drawImage: vi.fn() } as unknown as CanvasRenderingContext2D;
const canvas = {} as HTMLCanvasElement;
const frameAt = (seconds: number) => ({ timestamp: seconds * 1e6 }) as unknown as VideoFrame;

function collectorFor(wanted: number[]) {
  return createFrameCollector(wanted, canvas, ctx, 8, 8, 0);
}

beforeEach(() => {
  bitmaps = [];
  pendingBitmaps = [];
  vi.stubGlobal("createImageBitmap", () => {
    const bitmap: FakeBitmap = { close: vi.fn() };
    bitmaps.push(bitmap);
    return Promise.resolve(bitmap);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createFrameCollector", () => {
  it("settles to one bitmap per wanted timestamp and reports progress", async () => {
    const progress: [number, number][] = [];
    const collector = createFrameCollector([0, 1], canvas, ctx, 8, 8, 0, ({ done, total }) =>
      progress.push([done, total]),
    );

    collector.consume(frameAt(0));
    collector.consume(frameAt(1));
    const images = await collector.settle();

    expect(images).toHaveLength(2);
    expect(collector.isComplete()).toBe(true);
    expect(progress).toEqual([
      [1, 2],
      [2, 2],
    ]);
    for (const bitmap of bitmaps) expect(bitmap.close).not.toHaveBeenCalled();
  });

  it("closes what it captured when the pass is discarded", async () => {
    const collector = collectorFor([0, 1, 2]);

    collector.consume(frameAt(0));
    collector.consume(frameAt(1));
    await collector.discard();

    expect(bitmaps).toHaveLength(2);
    for (const bitmap of bitmaps) expect(bitmap.close).toHaveBeenCalledTimes(1);
  });

  it("waits for captures still in flight before closing them on discard", async () => {
    vi.stubGlobal(
      "createImageBitmap",
      () =>
        new Promise<FakeBitmap>((resolve) => {
          pendingBitmaps.push((bitmap) => {
            bitmaps.push(bitmap);
            resolve(bitmap);
          });
        }),
    );
    const collector = collectorFor([0]);

    collector.consume(frameAt(0));
    const discarded = collector.discard();
    pendingBitmaps[0]?.({ close: vi.fn() });
    await discarded;

    expect(bitmaps[0]?.close).toHaveBeenCalledTimes(1);
  });

  it("closes the bitmaps captured and rejects when one capture fails", async () => {
    let calls = 0;
    vi.stubGlobal("createImageBitmap", () => {
      calls++;
      if (calls === 2) return Promise.reject(new Error("capture failed"));
      const bitmap: FakeBitmap = { close: vi.fn() };
      bitmaps.push(bitmap);
      return Promise.resolve(bitmap);
    });
    const collector = collectorFor([0, 1]);

    collector.consume(frameAt(0));
    collector.consume(frameAt(1));

    await expect(collector.settle()).rejects.toThrowError("capture failed");
    expect(bitmaps[0]?.close).toHaveBeenCalledTimes(1);
  });
});
