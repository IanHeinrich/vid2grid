import { describe, expect, it } from "vitest";
import {
  assertPixelsMatchLog,
  createFrameStream,
  showinfoChecksum,
  type DecodedFrame,
} from "../src/frameStream";

const FRAME_BYTES = 4;
const TIME_BASE_LINE = "[Parsed_showinfo_2 @ 0000] config in time_base: 1/10, frame_rate: 10/1";

function frameLine(n: number, pts: string, pixels = Buffer.alloc(FRAME_BYTES)): string {
  const checksum = showinfoChecksum(pixels).toString(16).toUpperCase().padStart(8, "0");
  return `[Parsed_showinfo_2 @ 0000] n:   ${n} pts:     ${pts} pts_time:0 checksum:${checksum}`;
}

function collect() {
  const seen: DecodedFrame[] = [];
  const onFrame = (frame: DecodedFrame) => {
    seen.push(frame);
    return false;
  };
  return { seen, onFrame };
}

describe("createFrameStream", () => {
  it("pairs each logged frame with its pixels in order, whichever arrives first", () => {
    const { seen, onFrame } = collect();
    const stream = createFrameStream(FRAME_BYTES, onFrame);
    stream.readLogLine(TIME_BASE_LINE);
    stream.writePixels(Buffer.from([7, 7, 7, 7, 8, 8]));
    stream.readLogLine(frameLine(0, "0", Buffer.from([7, 7, 7, 7])));
    stream.readLogLine(frameLine(1, "3", Buffer.from([8, 8, 8, 8])));
    stream.writePixels(Buffer.from([8, 8]));
    stream.finish();

    expect(seen.map((frame) => [frame.exactSeconds, frame.pixels[0]])).toEqual([
      [0, 7],
      [0.3, 8],
    ]);
    for (const frame of seen) expect(() => assertPixelsMatchLog(frame)).not.toThrow();
  });

  it("passes a frame logged without a pts on as NaN", () => {
    const { seen, onFrame } = collect();
    const stream = createFrameStream(FRAME_BYTES, onFrame);
    stream.readLogLine(TIME_BASE_LINE);
    stream.readLogLine(frameLine(0, "NOPTS"));
    stream.writePixels(Buffer.alloc(FRAME_BYTES));
    expect(seen.map((frame) => frame.exactSeconds)).toEqual([NaN]);
  });

  it("stops handing frames over once the handler has all it wants", () => {
    let calls = 0;
    const stream = createFrameStream(FRAME_BYTES, () => ++calls === 1);
    stream.readLogLine(TIME_BASE_LINE);
    stream.readLogLine(frameLine(0, "0"));
    stream.readLogLine(frameLine(1, "1"));
    stream.writePixels(Buffer.alloc(FRAME_BYTES * 2));
    expect(calls).toBe(1);
    expect(stream.stopped).toBe(true);
    expect(() => stream.finish()).not.toThrow();
  });

  it("keeps the last non-showinfo lines for an error message", () => {
    const stream = createFrameStream(FRAME_BYTES, () => false);
    stream.readLogLine("Input #0, mov,mp4");
    stream.readLogLine("[Parsed_showinfo_2 @ 0000]   side data - display matrix");
    stream.readLogLine("missing.mp4: No such file or directory");
    expect(stream.logTail()).toBe("Input #0, mov,mp4\nmissing.mp4: No such file or directory");
  });
});

describe("createFrameStream guards", () => {
  it("rejects a frame logged before any time base", () => {
    const stream = createFrameStream(FRAME_BYTES, () => false);
    expect(() => stream.readLogLine(frameLine(0, "0"))).toThrow(
      "ffmpeg's showinfo logged a frame before its time base",
    );
  });

  it("rejects a frame logged without a checksum", () => {
    const stream = createFrameStream(FRAME_BYTES, () => false);
    stream.readLogLine(TIME_BASE_LINE);
    expect(() => stream.readLogLine("[Parsed_showinfo_2 @ 0000] n: 0 pts: 0 pts_time:0")).toThrow(
      "ffmpeg's showinfo logged no frame checksum",
    );
  });

  it("rejects at the end when pixels and timestamps do not pair up", () => {
    const stream = createFrameStream(FRAME_BYTES, () => false);
    stream.readLogLine(TIME_BASE_LINE);
    stream.readLogLine(frameLine(0, "0"));
    stream.readLogLine(frameLine(1, "1"));
    stream.writePixels(Buffer.alloc(FRAME_BYTES));
    expect(() => stream.finish()).toThrow("ffmpeg wrote 1 frames but logged 2 timestamps");
  });

  it("rejects at the end when a frame's pixels are cut short", () => {
    const stream = createFrameStream(FRAME_BYTES, () => false);
    stream.readLogLine(TIME_BASE_LINE);
    stream.readLogLine(frameLine(0, "0"));
    stream.writePixels(Buffer.alloc(FRAME_BYTES + 1));
    expect(() => stream.finish()).toThrow(
      "ffmpeg's output stopped 1 bytes into frame 2, which needs 4",
    );
  });

  // Frame 0's pixels never reached stdout, so frame 1's pixels pair with frame 0's log line.
  it("fails loudly when a frame is lost between the two outputs", () => {
    const { seen, onFrame } = collect();
    const stream = createFrameStream(FRAME_BYTES, onFrame);
    stream.readLogLine(TIME_BASE_LINE);
    stream.readLogLine(frameLine(0, "0", Buffer.from([1, 1, 1, 1])));
    stream.readLogLine(frameLine(1, "1", Buffer.from([2, 2, 2, 2])));
    stream.writePixels(Buffer.from([2, 2, 2, 2]));
    const [first] = seen;
    if (!first) throw new Error("no frame was paired");
    expect(() => assertPixelsMatchLog(first)).toThrow("a frame went missing");
  });
});

describe("showinfoChecksum", () => {
  // By hand, a = 1 + 2 + 3 and b = 1 + 3 + 6. That real ffmpeg agrees is proven by every
  // capture test, since capture checks each kept frame against its logged checksum.
  it("is adler32 seeded with 0", () => {
    expect(showinfoChecksum(Buffer.from([1, 2, 3]))).toBe(0x000a0006);
    expect(showinfoChecksum(Buffer.alloc(0))).toBe(0);
  });

  it("reduces the sums so a frame of any size stays exact", () => {
    const big = Buffer.alloc(1_000_000, 255);
    let a = 0;
    let b = 0;
    for (const byte of big) {
      a = (a + byte) % 65521;
      b = (b + a) % 65521;
    }
    expect(showinfoChecksum(big)).toBe(b * 0x10000 + a);
  });
});
