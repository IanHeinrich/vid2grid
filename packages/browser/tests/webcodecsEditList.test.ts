import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { RenderPlan } from "@vid2grid/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  extractFramesWebCodecs,
  readFrameTimestamps,
  readKeyframeTimestamps,
} from "../src/capture/webcodecsExtractor";

// 10 fps with B-frames, so the edit list starts the media two frames (0.2 s) in.
const bytes = readFileSync(
  resolve(import.meta.dirname, "../../../fixtures/videos/keyframes-20s.mp4"),
);

function fixtureFile(): File {
  const file = new File([], "keyframes-20s.mp4", { type: "video/mp4" });
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return Object.assign(file, { arrayBuffer: () => Promise.resolve(buffer) });
}

// Emits frames in presentation order, as a real decoder does.
class ReorderingDecoder {
  static readonly isConfigSupported = () => Promise.resolve({ supported: true });
  state: CodecState = "unconfigured";
  decodeQueueSize = 0;
  private readonly timestamps: number[] = [];

  constructor(private readonly init: VideoDecoderInit) {}

  configure(): void {
    this.state = "configured";
  }

  decode(chunk: { timestamp: number }): void {
    this.timestamps.push(chunk.timestamp);
    decodedChunks++;
  }

  flush(): Promise<void> {
    for (const timestamp of this.timestamps.sort((a, b) => a - b)) {
      this.init.output({ timestamp, close: () => {} } as unknown as VideoFrame);
    }
    return Promise.resolve();
  }

  close(): void {
    this.state = "closed";
  }
}

let drawn: number[];
let decodedChunks: number;

beforeEach(() => {
  drawn = [];
  decodedChunks = 0;
  vi.stubGlobal("VideoDecoder", ReorderingDecoder);
  vi.stubGlobal(
    "EncodedVideoChunk",
    class {
      readonly timestamp: number;
      constructor(init: EncodedVideoChunkInit) {
        this.timestamp = init.timestamp;
      }
    },
  );
  vi.spyOn(CanvasRenderingContext2D.prototype, "drawImage").mockImplementation((frame) => {
    drawn.push((frame as unknown as VideoFrame).timestamp / 1e6);
  });
  vi.stubGlobal("createImageBitmap", () => Promise.resolve({ close: () => {} }));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function capturedAt(times: number[]): Promise<number[]> {
  const plan = {
    frames: times.map((timestampSeconds, frameIndex) => ({ frameIndex, timestampSeconds })),
    cell: { width: 8, height: 8 },
  } as unknown as RenderPlan;
  const images = await extractFramesWebCodecs(fixtureFile(), plan);
  if (!images) throw new Error("The fast path declined the fixture");
  for await (const image of images) image.close();
  return drawn;
}

describe("a video whose edit list skips the B-frame delay", () => {
  it("captures the first frame at or after each time", async () => {
    expect(await capturedAt([0, 0.1, 3.05, 12.4, 19.9])).toEqual([0, 0.1, 3.1, 12.4, 19.9]);
  });

  it("captures nothing past the last frame", async () => {
    expect(await capturedAt([19.8, 19.95])).toEqual([19.8]);
  });

  it("times frames and keyframes on the same clock", async () => {
    const frames = await readFrameTimestamps(fixtureFile());
    const keyframes = await readKeyframeTimestamps(fixtureFile());
    expect(frames).toHaveLength(200);
    expect([frames?.[0], frames?.at(-1)]).toEqual([0, 19.9]);
    expect(keyframes?.[0]).toBe(0);
    expect(frames).toEqual(expect.arrayContaining(keyframes ?? []));
  });

  it("decodes only the keyframes a keyframe plan asks for", async () => {
    const keyframes = await readKeyframeTimestamps(fixtureFile());
    expect(keyframes).toEqual(Array.from({ length: 20 }, (_, second) => second));
    expect(await capturedAt([3, 4, 17])).toEqual([3, 4, 17]);
    expect(decodedChunks).toBe(3);
  });
});
