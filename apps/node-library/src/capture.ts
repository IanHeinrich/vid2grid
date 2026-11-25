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
import { readSeekFacts, readSeekLandings } from "./probe";
import { diedOnSignal, exitFailure } from "./processExit";
import { createSeekJudge, type SeekJudge } from "./seekJudge";
import {
  MIN_SKIPPED_SECONDS,
  minSkippedSeconds,
  seeksToTry,
  splitIntoSegments,
  type CaptureSegment,
} from "./segments";

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

// What a segment after the first is judged by.
interface LaterSegment {
  judge: SeekJudge;
  previousPlanned: number;
  // The planned times left from this segment on, and how many a try at decoding covers.
  remaining: number[];
  tryCount: number;
}

interface SegmentOutcome {
  filled: number;
  // "late": the first frame decoded was already past the first planned time.
  // "crashed": a signal killed the seeking ffmpeg before it gave a frame.
  ending: "filled" | "stream ended" | "late" | "crashed";
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
  const { segments, judge } = await planSegments(source, planned);
  const [first] = segments;
  if (!first) return;

  let filled = 0;
  let start = 0;
  for (const [i, segment] of segments.entries()) {
    // A try at decoding on from an earlier segment fills the ones it reaches.
    const alreadyFilled = filled > start;
    start += segment.plannedSeconds.length;
    if (alreadyFilled) continue;

    const previousPlanned = planned[filled - 1];
    const remaining = planned.slice(filled);
    const nextLength = segments[i + 1]?.plannedSeconds.length ?? 0;
    const tryCount = segment.plannedSeconds.length + nextLength;
    const later =
      previousPlanned === undefined ? undefined : { judge, previousPlanned, remaining, tryCount };
    const outcome = yield* captureSegment(source, segment, later);
    filled += outcome.filled;
    if (outcome.ending === "late" || outcome.ending === "crashed") {
      const seekSeconds = outcome.ending === "late" ? first.seekSeconds : 0;
      yield* captureStraightThrough(source, { seekSeconds, plannedSeconds: remaining });
      return;
    }
    if (outcome.ending === "stream ended") return;
  }
}

async function* captureStraightThrough(
  source: Source,
  segment: CaptureSegment,
): AsyncGenerator<RgbaFrame, void, undefined> {
  const { ending } = yield* captureSegment(source, segment);
  if (ending === "crashed") yield* captureSegment(source, { ...segment, seekSeconds: 0 });
}

async function planSegments(
  source: Source,
  planned: number[],
): Promise<{ segments: CaptureSegment[]; judge: SeekJudge }> {
  const straightThrough = {
    segments: splitIntoSegments(planned, new Map(), MIN_SKIPPED_SECONDS),
    judge: createSeekJudge(undefined),
  };
  // A keyframe-only decode is quick, and ffmpeg can time its frames differently after a seek.
  const maySeek = !source.keyframesOnly && seeksToTry(planned, MIN_SKIPPED_SECONDS).length > 0;
  if (!maySeek) return straightThrough;
  try {
    return await planSeeks(source, planned);
  } catch {
    throwIfAborted(source.signal);
    // Decoding straight through needs no probe, and reports a file that cannot be read.
    return straightThrough;
  }
}

async function planSeeks({ path, signal }: Source, planned: number[]) {
  const { startsWithPts, framesPerSecond, backOffSeconds } = await readSeekFacts(path, signal);
  const minSkipped = minSkippedSeconds(framesPerSecond);
  const seeks = startsWithPts ? seeksToTry(planned, minSkipped) : [];
  const landings = await readSeekLandings(path, seeks, backOffSeconds, signal);
  return {
    segments: splitIntoSegments(planned, landings, minSkipped),
    judge: createSeekJudge(framesPerSecond),
  };
}

// Without later, the segment may land late: nothing comes before it to fall back on.
async function* captureSegment(
  source: Source,
  segment: CaptureSegment,
  later?: LaterSegment,
): AsyncGenerator<RgbaFrame, SegmentOutcome, undefined> {
  const { width, height } = source.plan.cell;
  const ready: RgbaFrame[] = [];
  const filler = createFiller(source.plan, segment, ready, later);
  const args = ffmpegArgs(source, segment);
  let yielded = 0;
  try {
    const frameBytes = width * height * RGBA_BYTES;
    for await (const image of decodeFrames(source, args, frameBytes, ready, filler.onFrame)) {
      yielded++;
      yield image;
    }
  } catch (error) {
    if (yielded > 0 || segment.seekSeconds <= 0 || !diedOnSignal(error)) throw error;
    return { filled: 0, ending: "crashed" };
  }
  return filler.outcome();
}

function createFiller(
  plan: RenderPlan,
  { plannedSeconds }: CaptureSegment,
  ready: RgbaFrame[],
  later: LaterSegment | undefined,
): { onFrame: FrameHandler; outcome: () => SegmentOutcome } {
  const { width, height } = plan.cell;
  const [firstPlanned = 0] = plannedSeconds;
  const startedMs = performance.now();
  let matcher = createFrameMatcher(plannedSeconds);
  let filledCount = 0;
  let landed = later === undefined;
  let trying = false;
  // The frame before, once past this segment's own first, unless it filled a planned time and
  // so may have held ffmpeg up.
  let unhurried: { seconds: number; ms: number } | undefined;

  function land(seconds: number): void {
    landed = true;
    if (!later) return;
    const { judge, previousPlanned, remaining, tryCount } = later;
    trying = judge.seekTook(seconds - previousPlanned, performance.now() - startedMs);
    if (trying) matcher = createFrameMatcher(remaining.slice(0, tryCount));
  }
  function fill(seconds: number): number {
    const filled = matcher.fill(seconds).length;
    if (!later || !trying || !matcher.done) return filled;
    trying = false;
    if (!later.judge.decodingWon()) return filled;
    matcher = createFrameMatcher(later.remaining.slice(filledCount + filled));
    return filled + matcher.fill(seconds).length;
  }
  const onFrame: FrameHandler = (frame) => {
    const { exactSeconds, pixels } = frame;
    const decodedSeconds = roundToMicroseconds(exactSeconds);
    if (!Number.isFinite(decodedSeconds)) return false;
    if (!landed && decodedSeconds > firstPlanned) return true;
    if (!landed) land(decodedSeconds);
    const ms = performance.now();
    if (unhurried) later?.judge.decoded(decodedSeconds - unhurried.seconds, ms - unhurried.ms);
    const filled = fill(exactSeconds);
    unhurried = filled === 0 && filledCount > 0 ? { seconds: decodedSeconds, ms } : undefined;
    if (filled === 0) return false;
    // Checked only on kept frames: a frame lost from either stream shifts every pairing
    // after it, so the next kept frame's pixels no longer match its logged checksum.
    assertPixelsMatchLog(frame);
    const image: RgbaFrame = {
      width,
      height,
      data: new Uint8ClampedArray(pixels.buffer, pixels.byteOffset, pixels.length),
      decodedTimestampSeconds: decodedSeconds,
    };
    for (let i = 0; i < filled; i++) ready.push(image);
    filledCount += filled;
    return matcher.done;
  };
  const ending = () => {
    if (!landed) return "late";
    return matcher.done ? "filled" : "stream ended";
  };
  return { onFrame, outcome: () => ({ filled: filledCount, ending: ending() }) };
}

function ffmpegArgs(
  { path, plan, keyframesOnly }: Source,
  { seekSeconds, plannedSeconds: [firstPlanned = 0] }: CaptureSegment,
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
  const onExit = guarded((cause: Error | undefined) => {
    if (!stream.stopped && cause) {
      const message = `${cause.message} on ${path}:\n${stream.logTail()}`;
      throw new Vid2GridError("internal", message, { cause });
    }
    stream.finish();
    state.exited = true;
  });
  const onClose = (code: number | null, signal: NodeJS.Signals | null): void => {
    onExit(exitFailure("ffmpeg", code, signal));
  };
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
