import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFrameCollector, MAX_BUFFERED_FRAMES } from "../src/capture/webcodecsExtractor";

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

describe("createFrameCollector hand-over", () => {
  it("hands over one bitmap per wanted timestamp in order, then ends", async () => {
    const collector = collectorFor([0, 1]);

    collector.consume(frameAt(0));
    collector.consume(frameAt(1));

    expect(await collector.take()).toBe(bitmaps[0]);
    expect(await collector.take()).toBe(bitmaps[1]);
    expect(await collector.take()).toBeUndefined();
    for (const bitmap of bitmaps) expect(bitmap.close).not.toHaveBeenCalled();
  });

  it("ends short when the stream ends before every timestamp is filled", async () => {
    const collector = collectorFor([0, 1, 2]);

    collector.consume(frameAt(0));
    collector.end();

    expect(await collector.take()).toBe(bitmaps[0]);
    expect(await collector.take()).toBeUndefined();
  });

  it("hands over what it captured before rethrowing a decode failure", async () => {
    const collector = collectorFor([0, 1, 2]);
    const failure = new Error("decode failed");

    collector.consume(frameAt(0));
    collector.fail(failure);

    expect(await collector.take()).toBe(bitmaps[0]);
    await expect(collector.take()).rejects.toBe(failure);
  });

  it("asks for no more input while the buffer is full, and none once complete", async () => {
    const wanted = Array.from({ length: MAX_BUFFERED_FRAMES + 1 }, (_, i) => i);
    const collector = collectorFor(wanted);
    for (const seconds of wanted.slice(0, MAX_BUFFERED_FRAMES)) collector.consume(frameAt(seconds));

    let room: boolean | undefined;
    void collector.awaitRoom().then((value) => (room = value));
    await Promise.resolve();
    expect(room).toBeUndefined();

    await collector.take();
    await vi.waitFor(() => expect(room).toBe(true));

    collector.consume(frameAt(MAX_BUFFERED_FRAMES));
    expect(await collector.awaitRoom()).toBe(false);
  });
});

describe("createFrameCollector discard", () => {
  it("closes what it captured but never handed over when the pass is discarded", async () => {
    const collector = collectorFor([0, 1, 2]);

    collector.consume(frameAt(0));
    collector.consume(frameAt(1));
    await collector.take();
    await collector.discard();

    expect(bitmaps).toHaveLength(2);
    expect(bitmaps[0]?.close).not.toHaveBeenCalled();
    expect(bitmaps[1]?.close).toHaveBeenCalledTimes(1);
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
});

describe("createFrameCollector failures", () => {
  it("rejects the take of a capture that failed", async () => {
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

    expect(await collector.take()).toBe(bitmaps[0]);
    await expect(collector.take()).rejects.toThrowError("capture failed");
  });
});
