import { spawn, type ChildProcessByStdio } from "node:child_process";
import { createInterface } from "node:readline";
import type { Readable } from "node:stream";
import ffmpegPath from "ffmpeg-static";
import {
  createFrameMatcher,
  isKeyframePlan,
  roundToMicroseconds,
  Vid2GridError,
  type RenderPlan,
  type VideoInfo,
} from "@vid2grid/core";
import {
  assertPixelsMatchLog,
  createFrameStream,
  type FrameHandler,
  type FrameStream,
} from "./frameStream";

export interface RgbaFrame {
  width: number;
  height: number;
  data: Uint8ClampedArray;
  // The decoded frame's own time, at or after the planned time it fills.
  decodedTimestampSeconds: number;
}

const RGBA_BYTES = 4;

export async function* captureFrames(
  path: string,
  plan: RenderPlan,
  info: VideoInfo,
): AsyncGenerator<RgbaFrame, void, undefined> {
  const planned = plan.frames.map((frame) => frame.timestampSeconds);
  const firstSeconds = planned[0];
  if (firstSeconds === undefined) return;

  const { width, height } = plan.cell;
  const matcher = createFrameMatcher(planned);
  const ready: RgbaFrame[] = [];
  const keyframesOnly = isKeyframePlan(plan, info.keyframeTimestampsSeconds);
  const args = ffmpegArgs(path, plan, firstSeconds, keyframesOnly);
  yield* decodeFrames(path, args, width * height * RGBA_BYTES, ready, (frame) => {
    const { exactSeconds, pixels } = frame;
    const filled = matcher.fill(exactSeconds);
    if (filled.length === 0) return false;
    // Checked only on kept frames: a frame lost from either stream shifts every pairing
    // after it, so the next kept frame's pixels no longer match its logged checksum.
    assertPixelsMatchLog(frame);
    const image: RgbaFrame = {
      width,
      height,
      data: new Uint8ClampedArray(pixels.buffer, pixels.byteOffset, pixels.length),
      decodedTimestampSeconds: roundToMicroseconds(exactSeconds),
    };
    filled.forEach(() => ready.push(image));
    return matcher.done;
  });
}

// One ffmpeg process for the whole plan, from the keyframe before the first planned time.
function ffmpegArgs(
  path: string,
  plan: RenderPlan,
  firstSeconds: number,
  keyframesOnly: boolean,
): string[] {
  return [
    "-hide_banner",
    "-nostdin",
    "-nostats",
    ...(keyframesOnly ? ["-skip_frame", "nokey"] : []),
    // -seek_timestamp keeps ffmpeg from adding the container's start time to -ss, and
    // -copyts keeps the stream's own timestamps: the raw times Python's capture seeks by.
    ...(firstSeconds > 0
      ? ["-seek_timestamp", "1", "-ss", firstSeconds.toFixed(6), "-noaccurate_seek"]
      : []),
    "-copyts",
    "-i",
    path,
    "-map",
    "0:v:0",
    "-vf",
    `scale=${plan.cell.width}:${plan.cell.height}:flags=bicubic,format=rgba,showinfo`,
    "-fps_mode",
    "passthrough",
    "-f",
    "rawvideo",
    "pipe:1",
  ];
}

type Ffmpeg = ChildProcessByStdio<null, Readable, Readable>;

interface Decoding {
  failure: Error | undefined;
  exited: boolean;
  logEnded: boolean;
  wake: (() => void) | undefined;
}

// Yields what onFrame queues on ready. stdout is paused while a frame waits there or for
// its log line, so the pipe fills and ffmpeg blocks until the consumer pulls again.
async function* decodeFrames<T>(
  path: string,
  args: string[],
  frameBytes: number,
  ready: T[],
  onFrame: FrameHandler,
): AsyncGenerator<T, void, undefined> {
  const ffmpeg = spawnFfmpeg(path, args);
  const stream = createFrameStream(frameBytes, onFrame);
  const state: Decoding = { failure: undefined, exited: false, logEnded: false, wake: undefined };
  const flow = (): void => {
    const awaitingLog = stream.unpairedFrames > 0 && !state.logEnded;
    if (ready.length > 0 || awaitingLog) ffmpeg.stdout.pause();
    else ffmpeg.stdout.resume();
  };
  const detach = listen(ffmpeg, path, stream, state, flow);
  try {
    for (;;) {
      if (state.failure) throw state.failure;
      const next = ready.shift();
      if (next !== undefined) {
        yield next;
        continue;
      }
      if (state.exited || stream.stopped) return;
      flow();
      await new Promise<void>((resolve) => (state.wake = resolve));
    }
  } finally {
    detach();
    ffmpeg.kill();
    // A paused pipe is never read to its end, so it would hold the event loop open.
    ffmpeg.stdout.destroy();
    ffmpeg.stderr.destroy();
  }
}

// Anything thrown while handling ffmpeg's output stops ffmpeg and becomes state.failure.
function listen(
  ffmpeg: Ffmpeg,
  path: string,
  stream: FrameStream,
  state: Decoding,
  flow: () => void,
): () => void {
  const notify = (): void => {
    state.wake?.();
    state.wake = undefined;
  };
  const guarded =
    <V>(handle: (value: V) => void) =>
    (value: V): void => {
      if (state.failure) return;
      try {
        handle(value);
        if (stream.stopped) ffmpeg.kill();
        flow();
      } catch (error) {
        state.failure =
          error instanceof Error ? error : new Vid2GridError("internal", String(error));
        ffmpeg.kill();
      }
      notify();
    };

  const onPixels = guarded((chunk: Buffer) => stream.writePixels(chunk));
  const lines = createInterface({ input: ffmpeg.stderr });
  const onLine = guarded((line: string) => stream.readLogLine(line));
  // With the log over, pixels still waiting for a line must drain for finish() to see them.
  const onLogEnd = guarded(() => {
    state.logEnded = true;
  });
  const onError = (cause: Error): void => {
    state.failure ??= new Vid2GridError("internal", `ffmpeg could not start for ${path}`, {
      cause,
    });
    notify();
  };
  const onClose = guarded((code: number | null) => {
    if (!stream.stopped && code !== 0) {
      const message = `ffmpeg exited with code ${code} on ${path}:
${stream.logTail()}`;
      throw new Vid2GridError("internal", message);
    }
    stream.finish();
    state.exited = true;
  });
  ffmpeg.stdout.on("data", onPixels);
  lines.on("line", onLine);
  lines.on("close", onLogEnd);
  ffmpeg.on("error", onError);
  ffmpeg.on("close", onClose);

  return () => {
    ffmpeg.stdout.off("data", onPixels);
    lines.off("line", onLine);
    lines.off("close", onLogEnd);
    lines.close();
    // onError stays attached: a failed kill emits "error", which unheard would throw.
    ffmpeg.off("close", onClose);
  };
}

function spawnFfmpeg(path: string, args: string[]): Ffmpeg {
  const binary = ffmpegPath;
  if (!binary) throw new Vid2GridError("internal", "ffmpeg-static has no binary for this platform");
  try {
    return spawn(binary, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, AV_LOG_FORCE_NOCOLOR: "1" },
    });
  } catch (cause) {
    throw new Vid2GridError("internal", `ffmpeg could not start for ${path}`, { cause });
  }
}
