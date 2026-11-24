// Decodes in as few passes as the plan allows, unlike extractor.ts. Entry points return `null` for
// an input this path declines (the caller falls back); demux or decode failures throw.
import {
  createFrameMatcher,
  MICROSECONDS_PER_SECOND,
  secondsToMicroseconds,
  type AbortSignalLike,
  type PlannedCrop,
  type RenderPlan,
} from "@vid2grid/core";
import { createFrameCanvas } from "../shared/canvas";
import { abortError } from "../shared/workerRequest";
import { throwIfAborted, untilAborted } from "./abort";
import { createSpanPlanner } from "./decodeSpans";
import { readSamples } from "./sampleReader";
import { demuxCached } from "./videoDemuxer";
import {
  sampleTimeMicroseconds,
  selectKeyframeSampleIndices,
  type VideoSample,
} from "./videoSamples";

// Bounds memory on long clips rather than queuing the whole video at once.
const MAX_QUEUED_CHUNKS = 30;
const MAX_QUEUED_BYTES = 8 * 1024 * 1024;
// Captured frames waiting for the consumer; feeding the decoder pauses at this many.
export const MAX_BUFFERED_FRAMES = 8;
// How much further to decode when a planned frame never came out of the decoder.
const FIRST_EXTENSION_SAMPLES = 16;
// Refused in a row, after which the track is taken to mark no true key frames from there on.
const MAX_REFUSED_SYNCS = 8;

// A wrapper because TS otherwise carries stale "state !== closed" narrowing across an `await`.
function isDecoderClosed(decoder: VideoDecoder): boolean {
  return decoder.state === "closed";
}

// How a decoder turns down a chunk after a configure or flush that cannot start a decode.
function isNotAKeyframe(err: unknown): boolean {
  return err instanceof DOMException && err.name === "DataError";
}

function toEncodedVideoChunk(sample: VideoSample, data: Uint8Array): EncodedVideoChunk {
  return new EncodedVideoChunk({
    type: sample.is_sync ? "key" : "delta",
    timestamp: sampleTimeMicroseconds(sample),
    duration: secondsToMicroseconds(sample.duration / sample.timescale),
    data,
  });
}

// The cell is already display-oriented, so at 90/270 the rotated frame's width and height
// are swapped and the draw extents swap with them.
export function drawRotated(
  ctx: CanvasRenderingContext2D,
  frame: CanvasImageSource,
  cellW: number,
  cellH: number,
  rotation: number,
): void {
  if (rotation === 0) {
    ctx.drawImage(frame, 0, 0, cellW, cellH);
    return;
  }
  ctx.save();
  ctx.translate(cellW / 2, cellH / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  if (rotation === 90 || rotation === 270) {
    ctx.drawImage(frame, -cellH / 2, -cellW / 2, cellH, cellW);
  } else {
    ctx.drawImage(frame, -cellW / 2, -cellH / 2, cellW, cellH);
  }
  ctx.restore();
}

export interface FrameCollector {
  // How many planned frames have been captured so far, in plan order.
  filledCount(): number;
  consume(frame: VideoFrame): void;
  // True once there is room for more decoded frames, false when no more are wanted.
  awaitRoom(): Promise<boolean>;
  // The next frame in plan order, or undefined once the stream has ended.
  take(): Promise<ImageBitmap | undefined>;
  end(): void;
  fail(reason: unknown): void;
  discard(): Promise<void>;
}

// One decoded frame and how many consecutive planned times it fills, so a long still stretch
// holds one image rather than one per time.
interface Capture {
  image: Promise<ImageBitmap>;
  remaining: number;
}

function createChangeSignal() {
  const waiters: (() => void)[] = [];
  return {
    changed: () => {
      for (const wake of waiters.splice(0)) wake();
    },
    nextChange: () => new Promise<void>((resolve) => waiters.push(resolve)),
  };
}

// Awaited only when taken, so a failure must not count as unhandled meanwhile.
function captureCanvas(captureFrame: () => Promise<ImageBitmap>): Promise<ImageBitmap> {
  const capture = captureFrame();
  capture.catch(() => {});
  return capture;
}

function takeFirst(captures: Capture[]): Promise<ImageBitmap> | undefined {
  const [first] = captures;
  if (first && first.remaining > 1) {
    first.remaining--;
    return first.image.then((image) => createImageBitmap(image));
  }
  return captures.shift()?.image;
}

async function closeWhenSettled(captures: Capture[]): Promise<void> {
  for (const image of await Promise.allSettled(captures.map((capture) => capture.image))) {
    if (image.status === "fulfilled") image.value.close();
  }
}

function rethrow(reason: unknown): never {
  throw reason;
}

// First frame at or after each wanted timestamp, as in the seek-based path (not nearest-frame).
export function createFrameCollector(
  wanted: number[],
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  cellW: number,
  cellH: number,
  rotation: number,
  capture = () => createImageBitmap(canvas),
): FrameCollector {
  const captures: Capture[] = [];
  const matcher = createFrameMatcher(wanted);
  const { changed, nextChange } = createChangeSignal();
  let filledCount = 0;
  let discarded = false;
  let finish: (() => undefined) | null = null;

  return {
    filledCount: () => filledCount,
    consume(frame) {
      if (discarded || finish) return;
      const filled = matcher.fill(frame.timestamp / MICROSECONDS_PER_SECOND).length;
      if (filled === 0) return;
      drawRotated(ctx, frame, cellW, cellH, rotation);
      captures.push({ image: captureCanvas(capture), remaining: filled });
      filledCount += filled;
      changed();
    },
    async awaitRoom() {
      while (!discarded && !finish && !matcher.done) {
        if (captures.length < MAX_BUFFERED_FRAMES) return true;
        await nextChange();
      }
      return false;
    },
    async take() {
      for (;;) {
        const image = takeFirst(captures);
        if (image) {
          changed();
          return image;
        }
        if (filledCount === wanted.length) return undefined;
        if (finish) return finish();
        await nextChange();
      }
    },
    end() {
      finish ??= () => undefined;
      changed();
    },
    fail(reason) {
      finish ??= () => rethrow(reason);
      changed();
    },
    async discard() {
      discarded = true;
      changed();
      await closeWhenSettled(captures.splice(0));
    },
  };
}

interface ChunkFeeder {
  // False when no more frames are wanted.
  feed(indices: Iterable<number>): Promise<boolean>;
}

function* samplesAt(
  samples: readonly VideoSample[],
  indices: Iterable<number>,
): Generator<VideoSample, void, undefined> {
  for (const index of indices) {
    const sample = samples[index];
    if (sample) yield sample;
  }
}

function createChunkFeeder(
  decoder: VideoDecoder,
  file: File,
  samples: readonly VideoSample[],
  collector: FrameCollector,
  signal: AbortSignalLike | undefined,
): ChunkFeeder {
  const fedSizes: number[] = [];

  const isQueueFull = (): boolean => {
    fedSizes.splice(0, fedSizes.length - decoder.decodeQueueSize);
    const queuedBytes = fedSizes.reduce((total, size) => total + size, 0);
    return fedSizes.length > MAX_QUEUED_CHUNKS || queuedBytes > MAX_QUEUED_BYTES;
  };

  const roomInQueue = async (): Promise<void> => {
    while (!isDecoderClosed(decoder) && isQueueFull()) {
      await new Promise<void>((resolve) =>
        decoder.addEventListener("dequeue", () => resolve(), { once: true }),
      );
    }
  };

  return {
    async feed(indices) {
      for await (const { sample, data } of readSamples(file, samplesAt(samples, indices), signal)) {
        if (!(await collector.awaitRoom())) return false;
        await roomInQueue();
        if (isDecoderClosed(decoder)) return false;
        decoder.decode(toEncodedVideoChunk(sample, data));
        fedSizes.push(data.byteLength);
      }
      if (isDecoderClosed(decoder)) return false;
      await decoder.flush();
      return true;
    },
  };
}

function* range(startIndex: number, endIndex: number): Generator<number> {
  for (let i = startIndex; i <= endIndex; i++) yield i;
}

// Each span starts on a sync sample after a flush, as the decoder needs, and ends at the last
// planned frame before the next jump.
async function feedSpans(
  feeder: ChunkFeeder,
  samples: readonly VideoSample[],
  wanted: readonly number[],
  collector: FrameCollector,
): Promise<void> {
  const planner = createSpanPlanner(samples, wanted);
  const finalIndex = samples.length - 1;
  let extension = 0;
  let refusedSyncs = 0;
  for (;;) {
    const filledBefore = collector.filledCount();
    const span = planner.next(filledBefore, extension);
    if (!span) return;
    try {
      if (!(await feeder.feed(range(span.first, span.last)))) return;
    } catch (err) {
      if (!isNotAKeyframe(err) || span.first === 0) throw err;
      planner.rejectSync(span.first);
      if (++refusedSyncs > MAX_REFUSED_SYNCS) planner.stopTryingSyncs();
      continue;
    }
    planner.acceptSync(span.first);
    refusedSyncs = 0;
    if (collector.filledCount() > filledBefore) extension = 0;
    else if (span.last === finalIndex) return;
    else extension = Math.max(FIRST_EXTENSION_SAMPLES, extension * 2);
  }
}

export interface DecodeRequest {
  file: File;
  samples: readonly VideoSample[];
  // Set when the plan is keyframe-sampled: sync samples decode independently, so it never has to
  // decode the P/B frames in between.
  keyframeIndices: readonly number[] | null;
  wanted: number[];
  cell: { width: number; height: number };
  rotation: number;
  crop?: PlannedCrop | undefined;
  signal?: AbortSignalLike | undefined;
}

export async function* decodeFrames(
  decoderConfig: VideoDecoderConfig,
  { file, samples, keyframeIndices, wanted, cell, rotation, crop, signal }: DecodeRequest,
): AsyncGenerator<ImageBitmap, void, undefined> {
  throwIfAborted(signal);
  const { canvas, ctx, capture } = createFrameCanvas(cell, crop);
  const { width, height } = canvas;
  const collector = createFrameCollector(wanted, canvas, ctx, width, height, rotation, capture);
  const decoder = new VideoDecoder({
    output: (frame) => {
      try {
        collector.consume(frame);
      } catch (err) {
        collector.fail(err);
      } finally {
        frame.close();
      }
    },
    error: (error) => collector.fail(error),
  });
  const stop = (): void => {
    if (signal) collector.fail(abortError(signal));
  };

  try {
    signal?.addEventListener("abort", stop);
    decoder.configure(decoderConfig);
    const feeder = createChunkFeeder(decoder, file, samples, collector, signal);
    const feeding = keyframeIndices
      ? feeder.feed(keyframeIndices)
      : feedSpans(feeder, samples, wanted, collector);
    void feeding.then(
      () => collector.end(),
      (err: unknown) => collector.fail(err),
    );
    for (let image = await collector.take(); image; image = await collector.take()) {
      yield image;
      throwIfAborted(signal);
    }
  } finally {
    signal?.removeEventListener("abort", stop);
    if (!isDecoderClosed(decoder)) decoder.close();
    await collector.discard();
  }
}

async function* noFrames(): AsyncGenerator<ImageBitmap, void, undefined> {}

export async function extractFramesWebCodecs(
  file: File,
  plan: RenderPlan,
  signal?: AbortSignalLike,
): Promise<AsyncGenerator<ImageBitmap, void, undefined> | null> {
  if (typeof VideoDecoder === "undefined") return null;
  if (plan.frames.length === 0) return noFrames();

  // Shared with other readers of the file, so an abort only stops waiting for it.
  const demuxed = await untilAborted(demuxCached(file), signal);
  if (!demuxed) return null;
  const { videoTrack, description, samples, rotation } = demuxed;

  const codedWidth = videoTrack.video?.width;
  const codedHeight = videoTrack.video?.height;
  if (!codedWidth || !codedHeight) return null;

  const decoderConfig: VideoDecoderConfig = {
    codec: videoTrack.codec,
    codedWidth,
    codedHeight,
    description,
  };
  const support = await VideoDecoder.isConfigSupported(decoderConfig);
  if (!support.supported) return null;

  return decodeFrames(decoderConfig, {
    file,
    samples,
    keyframeIndices: selectKeyframeSampleIndices(samples, plan.frames),
    wanted: plan.frames.map((frame) => frame.timestampSeconds),
    cell: plan.cell,
    rotation,
    crop: plan.crop,
    signal,
  });
}
