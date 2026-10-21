import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Sample } from "mp4box";
import { decodeFrames, MAX_BUFFERED_FRAMES } from "../src/capture/webcodecsExtractor";

// jsdom has no WebCodecs, so this decoder emits each chunk back as a frame on the next
// microtask: enough to watch how far ahead of the consumer the pass decodes.
class FakeDecoder {
  static latest: FakeDecoder | undefined;
  state: CodecState = "unconfigured";
  decodeQueueSize = 0;
  readonly decoded: number[] = [];
  readonly frames: { close: ReturnType<typeof vi.fn> }[] = [];

  constructor(private readonly init: VideoDecoderInit) {
    FakeDecoder.latest = this;
  }

  configure(): void {
    this.state = "configured";
  }

  decode(chunk: { timestamp: number }): void {
    this.decoded.push(chunk.timestamp);
    queueMicrotask(() => {
      if (this.state === "closed") return;
      const frame = { timestamp: chunk.timestamp, close: vi.fn() };
      this.frames.push(frame);
      this.init.output(frame as unknown as VideoFrame);
    });
  }

  flush(): Promise<void> {
    return Promise.resolve();
  }

  close(): void {
    this.state = "closed";
  }
}

const FRAME_COUNT = 4 * MAX_BUFFERED_FRAMES;
const TIMESCALE = 10;

const samples = Array.from({ length: FRAME_COUNT }, (_, i) => ({
  is_sync: true,
  cts: i,
  dts: i,
  timescale: TIMESCALE,
  duration: 1,
  data: new Uint8Array([0]),
})) as unknown as Sample[];
const wanted = Array.from({ length: FRAME_COUNT }, (_, i) => i / TIMESCALE);
const indices = Array.from({ length: FRAME_COUNT }, (_, i) => i);

let bitmaps: { close: ReturnType<typeof vi.fn> }[];

function decoder(): FakeDecoder {
  if (!FakeDecoder.latest) throw new Error("No decoder was created");
  return FakeDecoder.latest;
}

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function decodeAll() {
  return decodeFrames({ codec: "avc1" }, samples, indices, wanted, { width: 8, height: 8 }, 0);
}

beforeEach(() => {
  bitmaps = [];
  FakeDecoder.latest = undefined;
  vi.stubGlobal("VideoDecoder", FakeDecoder);
  vi.stubGlobal(
    "EncodedVideoChunk",
    class {
      readonly timestamp: number;
      constructor(init: EncodedVideoChunkInit) {
        this.timestamp = init.timestamp;
      }
    },
  );
  vi.spyOn(CanvasRenderingContext2D.prototype, "drawImage").mockImplementation(() => {});
  vi.stubGlobal("createImageBitmap", () => {
    const bitmap = { close: vi.fn() };
    bitmaps.push(bitmap);
    return Promise.resolve(bitmap);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("decodeFrames", () => {
  it("yields every wanted frame in plan order and closes each decoded frame", async () => {
    const images: ImageBitmap[] = [];
    for await (const image of decodeAll()) images.push(image);

    expect(images).toEqual(bitmaps);
    expect(images).toHaveLength(FRAME_COUNT);
    for (const frame of decoder().frames) expect(frame.close).toHaveBeenCalledTimes(1);
    expect(decoder().state).toBe("closed");
  });

  it("decodes only a bounded buffer ahead of what the consumer has pulled", async () => {
    const frames = decodeAll();
    const decodedAfter: number[] = [];

    for (let pulled = 1; pulled <= 4; pulled++) {
      await frames.next();
      await settle();
      decodedAfter.push(decoder().decoded.length);
      // The frames handed over, a full buffer, and one chunk the decoder has yet to emit.
      expect(decoder().decoded.length).toBeLessThanOrEqual(pulled + MAX_BUFFERED_FRAMES + 1);
    }

    expect(decodedAfter.at(-1)).toBeGreaterThan(decodedAfter[0] ?? Infinity);
    await frames.return();
  });

  it("closes the decoder and every frame not yet handed over when the consumer stops", async () => {
    const frames = decodeAll();

    const first = await frames.next();
    await settle();
    await frames.return();

    expect(decoder().state).toBe("closed");
    expect(bitmaps.length).toBeGreaterThan(1);
    const [handedOver, ...buffered] = bitmaps;
    expect(first.value).toBe(handedOver);
    expect(handedOver?.close).not.toHaveBeenCalled();
    for (const bitmap of buffered) expect(bitmap.close).toHaveBeenCalledTimes(1);
  });
});
