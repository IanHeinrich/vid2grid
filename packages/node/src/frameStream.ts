import { Vid2GridError } from "@vid2grid/core";

export interface DecodedFrame {
  exactSeconds: number;
  pixels: Buffer;
  // showinfo's checksum of the frame it logged this time for; see showinfoChecksum.
  checksum: number;
}

// Called once per decoded frame, in order; returns true once nothing more is wanted.
export type FrameHandler = (frame: DecodedFrame) => boolean;

export interface FrameStream {
  writePixels(chunk: Buffer): void;
  readLogLine(line: string): void;
  // Throws when ffmpeg exited cleanly yet its pixels and timestamps do not pair up.
  finish(): void;
  readonly stopped: boolean;
  // Frames whose pixels have arrived but whose log line has not.
  readonly unpairedFrames: number;
  logTail(): string;
}

interface LoggedFrame {
  exactSeconds: number;
  checksum: number;
}

const SHOWINFO_TIME_BASE = /config in time_base:\s*(\d+)\/(\d+)/;
const SHOWINFO_FRAME = /\] n:\s*\d+\s+pts:\s*(\S+)/;
const SHOWINFO_CHECKSUM = /\bchecksum:([0-9A-Fa-f]{8})\b/;
const STDERR_LINES_KEPT = 20;
const ADLER_MODULUS = 65521;
// The most bytes the two adler sums can take before either needs reducing.
const ADLER_BLOCK_BYTES = 5552;

// showinfo logs each frame's pts on stderr while its pixels arrive on stdout, so the two
// are paired in order once both have been read. A frame logged as "NOPTS" becomes NaN,
// which core's matcher lets fill no planned time.
export function createFrameStream(frameBytes: number, onFrame: FrameHandler): FrameStream {
  const logged: LoggedFrame[] = [];
  const frames: Buffer[] = [];
  const counts = { logged: 0, frames: 0 };
  const log = showinfoLog((frame) => {
    logged.push(frame);
    counts.logged++;
    pair();
  });
  let stopped = false;

  function pair(): void {
    const paired = Math.min(logged.length, frames.length);
    const pairedLog = logged.splice(0, paired);
    const pairedPixels = frames.splice(0, paired);
    pairedLog.forEach((entry, i) => {
      const pixels = pairedPixels[i];
      if (!stopped && pixels) stopped = onFrame({ ...entry, pixels });
    });
  }
  const splitter = frameSplitter(frameBytes, (pixels) => {
    frames.push(pixels);
    counts.frames++;
    pair();
  });

  // Once stopped, ffmpeg is being killed and may die partway through a frame or a line.
  return {
    writePixels(chunk) {
      if (!stopped) splitter.write(chunk);
    },
    readLogLine(line) {
      if (!stopped) log.read(line);
    },
    finish() {
      if (stopped) return;
      const partialBytes = splitter.partialBytes();
      if (partialBytes > 0) {
        throw internal(
          `ffmpeg's output stopped ${partialBytes} bytes into frame ${counts.frames + 1}, ` +
            `which needs ${frameBytes}`,
        );
      }
      if (counts.logged !== counts.frames) {
        throw internal(
          `ffmpeg wrote ${counts.frames} frames but logged ${counts.logged} timestamps`,
        );
      }
    },
    get stopped() {
      return stopped;
    },
    get unpairedFrames() {
      return frames.length;
    },
    logTail: () => log.tail(),
  };
}

export function assertPixelsMatchLog({ exactSeconds, pixels, checksum }: DecodedFrame): void {
  if (showinfoChecksum(pixels) === checksum) return;
  throw internal(
    `ffmpeg's pixels for the frame at ${exactSeconds}s do not match the checksum it logged ` +
      "for that frame, so a frame went missing between its two outputs",
  );
}

// showinfo's checksum is adler32 seeded with 0, not the usual 1, over the frame as it
// leaves the rgba conversion: the same bytes the raw output writes.
export function showinfoChecksum(pixels: Uint8Array): number {
  let a = 0;
  let b = 0;
  for (let start = 0; start < pixels.length; start += ADLER_BLOCK_BYTES) {
    const end = Math.min(start + ADLER_BLOCK_BYTES, pixels.length);
    for (let i = start; i < end; i++) {
      a += pixels[i] ?? 0;
      b += a;
    }
    a %= ADLER_MODULUS;
    b %= ADLER_MODULUS;
  }
  return b * 0x10000 + a;
}

function showinfoLog(onFrame: (frame: LoggedFrame) => void) {
  let timeBase: { num: number; den: number } | undefined;
  // ffmpeg 7 logs from several threads, so another message can land inside a frame's line
  // and push its checksum onto the next line.
  let awaitingChecksum: number | undefined;
  const tail: string[] = [];
  return {
    read(line: string): void {
      const config = SHOWINFO_TIME_BASE.exec(line);
      if (config) {
        timeBase = { num: Number(config[1]), den: Number(config[2]) };
        return;
      }
      const frame = SHOWINFO_FRAME.exec(line);
      if (frame) {
        if (!timeBase) throw internal("ffmpeg's showinfo logged a frame before its time base");
        if (awaitingChecksum !== undefined) {
          throw internal("ffmpeg's showinfo logged no frame checksum");
        }
        awaitingChecksum = (Number(frame[1]) * timeBase.num) / timeBase.den;
      }
      const checksum = SHOWINFO_CHECKSUM.exec(line)?.[1];
      if (awaitingChecksum !== undefined && checksum !== undefined) {
        onFrame({ exactSeconds: awaitingChecksum, checksum: parseInt(checksum, 16) });
        awaitingChecksum = undefined;
      } else if (!frame && !line.startsWith("[Parsed_showinfo")) {
        tail.push(line);
        if (tail.length > STDERR_LINES_KEPT) tail.shift();
      }
    },
    tail: (): string => tail.join("\n"),
  };
}

function frameSplitter(frameBytes: number, onFrame: (pixels: Buffer) => void) {
  let pixels = Buffer.allocUnsafe(frameBytes);
  let filled = 0;
  return {
    write(chunk: Buffer): void {
      let offset = 0;
      while (offset < chunk.length) {
        const copied = chunk.copy(pixels, filled, offset);
        offset += copied;
        filled += copied;
        if (filled === frameBytes) {
          onFrame(pixels);
          pixels = Buffer.allocUnsafe(frameBytes);
          filled = 0;
        }
      }
    },
    partialBytes: () => filled,
  };
}

function internal(message: string): Vid2GridError {
  return new Vid2GridError("internal", message);
}
