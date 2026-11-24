import { spawn, type ChildProcessByStdio } from "node:child_process";
import { createInterface } from "node:readline";
import type { Readable } from "node:stream";
import ffmpegPath from "ffmpeg-static";
import {
  createFrameMatcher,
  isKeyframePlan,
  roundToMicroseconds,
  Vid2GridError,
  type AbortSignalLike,
  type RenderPlan,
  type VideoInfo,
} from "@vid2grid/core";
import { onAbort, throwIfAborted } from "./abort";
import {
  assertPixelsMatchLog,
  createFrameStream,
  type FrameHandler,
  type FrameStream,
} from "./frameStream";
import { readSeekLandings } from "./probe";
import { seeksToTry, splitIntoSegments, type CaptureSegment } from "./segments";

export interface RgbaFrame {
  width: number;
  height: number;
  data: Uint8ClampedArray;
  // The decoded frame's own time, at or after the planned time it fills.
  decodedTimestampSeconds: number;
}

const RGBA_BYTES = 4;
// Wider than the matcher's microsecond rounding, so the filter keeps every frame it could pick.
const SELECT_MARGIN_SECONDS = 0.001;

interface Source {
  path: string;
  plan: RenderPlan;
  keyframesOnly: boolean;
  signal: AbortSignalLike | undefined;
}

interface SegmentOutcome {
  filled: number;
  // The first frame decoded was already past the first planned time.
  landedLate: boolean;
}

export async function* captureFrames(
  path: string,
  plan: RenderPlan,
  info: VideoInfo,
  signal?: AbortSignalLike,
): AsyncGenerator<RgbaFrame, void, undefined> {
  const planned = plan.frames.map((frame) => frame.timestampSeconds);
  const keyframesOnly = isKeyframePlan(plan, info.keyframeTimestampsSeconds);
  const source = { path, plan, keyframesOnly, signal };
  const segments = await planSegments(source, planned);
  const [first] = segments;
  if (!first) return;

  let filled = 0;
  for (const segment of segments) {
    // Nothing comes before the first segment to fall back on, so it may land late.
    const outcome = yield* captureSegment(source, segment, segment === first);
    filled += outcome.filled;
    if (outcome.landedLate) {
      const rest = { ...first, plannedSeconds: planned.slice(filled) };
      yield* captureSegment(source, rest, true);
      return;
    }
    if (outcome.filled < segment.plannedSeconds.length) return;
  }
}

async function planSegments(
  { path, keyframesOnly, signal }: Source,
  planned: number[],
): Promise<CaptureSegment[]> {
  // A keyframe-only decode is quick, and ffmpeg can time its frames differently after a seek.
  const seeks = keyframesOnly ? [] : seeksToTry(planned);
  const landings = await readSeekLandings(path, seeks, signal).catch(() => {
    throwIfAborted(signal);
    // Decoding straight through needs no landings, and reports a file that cannot be read.
    return new Map<number, number>();
  });
  return splitIntoSegments(planned, landings);
}

async function* captureSegment(
  source: Source,
  segment: CaptureSegment,
  mayLandLate: boolean,
): AsyncGenerator<RgbaFrame, SegmentOutcome, undefined> {
  const { width, height } = source.plan.cell;
  const { plannedSeconds } = segment;
  const [firstPlanned = 0] = plannedSeconds;
  const matcher = createFrameMatcher(plannedSeconds);
  const ready: RgbaFrame[] = [];
  let landed = mayLandLate;
  let filledCount = 0;
  const args = ffmpegArgs(source, segment.seekSeconds, firstPlanned);
  yield* decodeFrames(source, args, width * height * RGBA_BYTES, ready, (frame) => {
    const { exactSeconds, pixels } = frame;
    const decodedSeconds = roundToMicroseconds(exactSeconds);
    landed ||= decodedSeconds <= firstPlanned;
    if (!landed) return Number.isFinite(decodedSeconds);
    const filled = matcher.fill(exactSeconds);
    if (filled.length === 0) return false;
    // Checked only on kept frames: a frame lost from either stream shifts every pairing
    // after it, so the next kept frame's pixels no longer match its logged checksum.
    assertPixelsMatchLog(frame);
    const image: RgbaFrame = {
      width,
      height,
      data: new Uint8ClampedArray(pixels.buffer, pixels.byteOffset, pixels.length),
      decodedTimestampSeconds: decodedSeconds,
    };
    filled.forEach(() => ready.push(image));
    filledCount += filled.length;
    return matcher.done;
  });
  return { filled: filledCount, landedLate: !landed };
}

function ffmpegArgs(
  { path, plan, keyframesOnly }: Source,
  seekSeconds: number,
  firstPlanned: number,
): string[] {
  return [
    "-hide_banner",
    "-nostdin",
    "-nostats",
    ...(keyframesOnly ? ["-skip_frame", "nokey"] : []),
    // -seek_timestamp keeps ffmpeg from adding the container's start time to -ss, and
    // -copyts keeps the stream's own timestamps: the raw times Python's capture seeks by.
    ...(seekSeconds > 0
      ? ["-seek_timestamp", "1", "-ss", seekSeconds.toFixed(6), "-noaccurate_seek"]
      : []),
    "-copyts",
    "-i",
    path,
    "-map",
    "0:v:0",
    "-vf",
    filterGraph(plan, firstPlanned),
    "-fps_mode",
    "passthrough",
    "-f",
    "rawvideo",
    "pipe:1",
  ];
}

// Frames before the first planned time are decoded but not scaled or piped out, except the
// very first, which shows where the seek landed.
function filterGraph(plan: RenderPlan, firstPlanned: number): string {
  const { width, height } = plan.cell;
  const wanted = `select='eq(n,0)+gte(t,${(firstPlanned - SELECT_MARGIN_SECONDS).toFixed(6)})'`;
  return `${wanted},${cropFilters(plan)}scale=${width}:${height}:flags=bicubic,format=rgba,showinfo`;
}

// Cropped as rgba because on subsampled formats the crop filter rounds to whole chroma pixels.
function cropFilters({ crop }: RenderPlan): string {
  if (!crop) return "";
  const { x, y, width, height, sourceWidth, sourceHeight } = crop;
  return (
    `scale=${sourceWidth}:${sourceHeight}:flags=bicubic,format=rgba,` +
    `crop=${width}:${height}:${x}:${y},`
  );
}

type Ffmpeg = ChildProcessByStdio<null, Readable, Readable>;

interface Decoding {
  failure: { reason: unknown } | undefined;
  exited: boolean;
  logEnded: boolean;
  wake: (() => void) | undefined;
}

// Yields what onFrame queues on ready. stdout is paused while a frame waits there or for
// its log line, so the pipe fills and ffmpeg blocks until the consumer pulls again.
async function* decodeFrames<T>(
  { path, signal }: Source,
  args: string[],
  frameBytes: number,
  ready: T[],
  onFrame: FrameHandler,
): AsyncGenerator<T, void, undefined> {
  throwIfAborted(signal);
  const ffmpeg = spawnFfmpeg(path, args);
  const stream = createFrameStream(frameBytes, onFrame);
  const state: Decoding = { failure: undefined, exited: false, logEnded: false, wake: undefined };
  const flow = (): void => {
    const awaitingLog = stream.unpairedFrames > 0 && !state.logEnded;
    if (ready.length > 0 || awaitingLog) ffmpeg.stdout.pause();
    else ffmpeg.stdout.resume();
  };
  const detach = listen(ffmpeg, path, stream, state, flow);
  const stopListening = onAbort(signal, (reason) => {
    state.failure ??= { reason };
    if (!state.exited) stopFfmpeg(ffmpeg);
    // The consumer may never pull again, and a paused pipe would hold the event loop.
    ffmpeg.stdout.resume();
    wake(state);
  });
  try {
    for (;;) {
      if (state.failure) throw state.failure.reason;
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
    stopListening();
    detach();
    if (!state.exited) stopFfmpeg(ffmpeg);
    // Drained, not left paused, so the pipes reach their end and stop holding the event loop.
    ffmpeg.stdout.resume();
    ffmpeg.stderr.resume();
  }
}

function wake(state: Decoding): void {
  state.wake?.();
  state.wake = undefined;
}

// Anything thrown while handling ffmpeg's output stops ffmpeg and becomes state.failure.
function listen(
  ffmpeg: Ffmpeg,
  path: string,
  stream: FrameStream,
  state: Decoding,
  flow: () => void,
): () => void {
  const guarded =
    <V>(handle: (value: V) => void) =>
    (value: V): void => {
      if (state.failure) return;
      try {
        handle(value);
        if (stream.stopped) stopFfmpeg(ffmpeg);
        flow();
      } catch (error) {
        state.failure = { reason: error };
        stopFfmpeg(ffmpeg);
      }
      wake(state);
    };

  const onPixels = guarded((chunk: Buffer) => stream.writePixels(chunk));
  const lines = createInterface({ input: ffmpeg.stderr });
  const onLine = guarded((line: string) => stream.readLogLine(line));
  // With the log over, pixels still waiting for a line must drain for finish() to see them.
  const onLogEnd = guarded(() => {
    state.logEnded = true;
  });
  const onError = (cause: Error): void => {
    state.failure ??= {
      reason: new Vid2GridError("internal", `ffmpeg could not start for ${path}`, { cause }),
    };
    wake(state);
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

// SIGKILL because ffmpeg 7 on Linux traps SIGTERM and still decodes the rest of the input,
// and only once: repeated signals make it log a warning into the middle of a showinfo line.
function stopFfmpeg(ffmpeg: Ffmpeg): void {
  if (!ffmpeg.killed) ffmpeg.kill("SIGKILL");
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
