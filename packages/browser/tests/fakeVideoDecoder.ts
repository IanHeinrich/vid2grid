import { vi } from "vitest";

const REORDER_DEPTH = 4;

export interface FakeFrame {
  timestamp: number;
  // Decoded from a later sync than it needed, so a real decoder would drop it or garble it.
  isCorrupt: boolean;
  close: ReturnType<typeof vi.fn>;
}

interface FakeChunk {
  type: EncodedVideoChunkType;
  timestamp: number;
}

// jsdom has no WebCodecs. Like a real decoder this emits in presentation order a few frames late,
// and starts after a configure or a flush only on a key chunk it accepts.
export class FakeVideoDecoder {
  static readonly isConfigSupported = () => Promise.resolve({ supported: true });
  static instances: FakeVideoDecoder[] = [];
  static refusedKeys = new Set<number>();
  static neverEmitted = new Set<number>();
  static failsAt: number | null = null;

  state: CodecState = "unconfigured";
  readonly decodeQueueSize = 0;
  readonly decoded: number[] = [];
  readonly starts: number[] = [];
  readonly frames: FakeFrame[] = [];
  flushes = 0;
  private held: number[] = [];
  private startedAt: number | null = null;

  constructor(private readonly init: VideoDecoderInit) {
    FakeVideoDecoder.instances.push(this);
  }

  configure(): void {
    this.state = "configured";
  }

  decode(chunk: FakeChunk): void {
    if (this.startedAt === null) {
      if (chunk.type !== "key" || FakeVideoDecoder.refusedKeys.has(chunk.timestamp)) {
        throw new DOMException("A key frame is required", "DataError");
      }
      this.startedAt = chunk.timestamp;
      this.starts.push(chunk.timestamp);
    }
    if (chunk.timestamp === FakeVideoDecoder.failsAt) {
      this.state = "closed";
      this.init.error(new DOMException("bad data", "EncodingError"));
      return;
    }
    this.decoded.push(chunk.timestamp);
    this.held.push(chunk.timestamp);
    this.held.sort((a, b) => a - b);
    while (this.held.length > REORDER_DEPTH) this.emitNext();
  }

  async flush(): Promise<void> {
    this.flushes++;
    await Promise.resolve();
    while (this.held.length > 0) this.emitNext();
    this.startedAt = null;
  }

  close(): void {
    this.state = "closed";
  }

  private emitNext(): void {
    const timestamp = this.held.shift();
    if (timestamp === undefined || this.state === "closed") return;
    if (FakeVideoDecoder.neverEmitted.has(timestamp)) return;
    const isCorrupt = timestamp < (this.startedAt ?? 0);
    const frame: FakeFrame = { timestamp, isCorrupt, close: vi.fn() };
    this.frames.push(frame);
    this.init.output(frame as unknown as VideoFrame);
  }
}

export interface FakeWebCodecs {
  drawn: FakeFrame[];
  bitmaps: { close: ReturnType<typeof vi.fn> }[];
}

export function stubWebCodecs(): FakeWebCodecs {
  FakeVideoDecoder.instances = [];
  FakeVideoDecoder.refusedKeys = new Set();
  FakeVideoDecoder.neverEmitted = new Set();
  FakeVideoDecoder.failsAt = null;
  const fake: FakeWebCodecs = { drawn: [], bitmaps: [] };
  vi.stubGlobal("VideoDecoder", FakeVideoDecoder);
  vi.stubGlobal(
    "EncodedVideoChunk",
    class {
      readonly type: EncodedVideoChunkType;
      readonly timestamp: number;
      constructor(init: EncodedVideoChunkInit) {
        this.type = init.type;
        this.timestamp = init.timestamp;
      }
    },
  );
  vi.spyOn(CanvasRenderingContext2D.prototype, "drawImage").mockImplementation((frame) => {
    fake.drawn.push(frame as unknown as FakeFrame);
  });
  vi.stubGlobal("createImageBitmap", () => {
    const bitmap = { close: vi.fn() };
    fake.bitmaps.push(bitmap);
    return Promise.resolve(bitmap);
  });
  return fake;
}
