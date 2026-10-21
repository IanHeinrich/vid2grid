// One continuous decode pass, unlike extractor.ts. Entry points return `null` for an input
// this path declines (the caller falls back); demux or decode failures throw.
import {
  createFile,
  MP4BoxBuffer,
  DataStream,
  Endianness,
  type ISOFile,
  type Movie,
  type Sample,
  type Track,
  type VisualSampleEntry,
} from "mp4box";
import {
  createFrameMatcher,
  isKeyframePlan,
  keyframesInRange,
  MICROSECONDS_PER_SECOND,
  roundToMicroseconds,
  rotationFromMatrix,
  secondsToMicroseconds,
  type PlannedFrame,
  type RenderPlan,
} from "@vid2grid/core";
import { createCellCanvas } from "../shared/canvas";
import { supportsWebCodecs } from "./isoBmff";

// Generous upper bound on B-frame reorder depth: without the padding, composition-order
// reordering could cut off a wanted frame at the end of the range.
const REORDER_PADDING_SAMPLES = 16;
// Bounds memory on long clips rather than queuing the whole video at once.
const MAX_DECODE_QUEUE_SIZE = 30;
// Captured frames waiting for the consumer; feeding the decoder pauses at this many.
export const MAX_BUFFERED_FRAMES = 8;

interface DemuxResult {
  videoTrack: Track;
  description: Uint8Array;
  samples: Sample[];
  rotation: number;
}

function sampleTimeSeconds(sample: Sample): number {
  return sample.cts / sample.timescale;
}

// Demuxing is independent of the collage settings, so regenerating with new settings reuses it.
// Keyed by File identity so a re-picked file re-parses and old entries are collectable.
const demuxCache = new WeakMap<File, Promise<DemuxResult | null>>();

function demuxCached(file: File): Promise<DemuxResult | null> {
  let cached = demuxCache.get(file);
  if (!cached) {
    cached = demux(file).catch((err: unknown) => {
      // A failed parse must not poison the entry: a retry should get a fresh attempt.
      demuxCache.delete(file);
      throw err;
    });
    demuxCache.set(file, cached);
  }
  return cached;
}

function getCodecDescription(isoFile: ISOFile, trackId: number): Uint8Array | undefined {
  const trak = isoFile.getTrackById(trackId);
  const entries = trak.mdia.minf.stbl.stsd.entries as VisualSampleEntry[];
  for (const entry of entries) {
    const box = entry.avcC ?? entry.hvcC ?? entry.vpcC ?? entry.av1C;
    if (!box) continue;
    const stream = new DataStream(undefined, 0, Endianness.BIG_ENDIAN);
    (box.write as (stream: DataStream) => void)(stream);
    // VideoDecoder wants the configuration payload alone, past the 8-byte box header.
    return new Uint8Array(stream.buffer, 8);
  }
  return undefined;
}

async function demux(file: File): Promise<DemuxResult | null> {
  const buffer = await file.arrayBuffer();
  const isoFile = createFile();

  return new Promise<DemuxResult | null>((resolve, reject) => {
    const samples: Sample[] = [];

    isoFile.onError = (_module, message) => reject(new Error(message));

    isoFile.onReady = (movie: Movie) => {
      const videoTrack = movie.videoTracks[0];
      if (!videoTrack) {
        resolve(null);
        return;
      }
      const description = getCodecDescription(isoFile, videoTrack.id);
      if (!description) {
        resolve(null);
        return;
      }

      isoFile.onSamples = (_id, _user, newSamples) => {
        samples.push(...newSamples);
        if (samples.length >= videoTrack.nb_samples) {
          resolve({
            videoTrack,
            description,
            samples,
            rotation: rotationFromMatrix(videoTrack.matrix),
          });
        }
      };
      isoFile.setExtractionOptions(videoTrack.id, undefined, { nbSamples: videoTrack.nb_samples });
      isoFile.start();
    };

    const mp4Buffer = MP4BoxBuffer.fromArrayBuffer(buffer, 0);
    isoFile.appendBuffer(mp4Buffer);
    isoFile.flush();
  });
}

/** Every sync sample's composition time, ascending, rounded the way the planner rounds. */
export function keyframeTimestampsFromSamples(samples: Sample[]): number[] {
  return samples
    .filter((sample) => sample.is_sync)
    .map((sample) => roundToMicroseconds(sampleTimeSeconds(sample)))
    .sort((a, b) => a - b);
}

export async function readKeyframeTimestamps(file: File): Promise<number[] | null> {
  if (!supportsWebCodecs(file)) return null;
  const demuxed = await demuxCached(file);
  if (!demuxed) return null;
  return keyframeTimestampsFromSamples(demuxed.samples);
}

export async function countKeyframesInRange(
  file: File,
  startTime: number,
  endTime: number,
): Promise<number | null> {
  const timestamps = await readKeyframeTimestamps(file);
  if (!timestamps) return null;
  return keyframesInRange(timestamps, startTime, endTime).length;
}

/** `null` means the plan is not keyframe-sampled and needs a full decode pass. */
export function selectKeyframeSampleIndices(
  samples: Sample[],
  frames: PlannedFrame[],
): number[] | null {
  if (frames.length === 0 || !isKeyframePlan({ frames }, keyframeTimestampsFromSamples(samples))) {
    return null;
  }
  const indexByTime = new Map<number, number>();
  samples.forEach((sample, index) => {
    if (!sample.is_sync) return;
    const time = roundToMicroseconds(sampleTimeSeconds(sample));
    if (!indexByTime.has(time)) indexByTime.set(time, index);
  });
  return frames.flatMap((frame) => {
    const index = indexByTime.get(roundToMicroseconds(frame.timestampSeconds));
    return index === undefined ? [] : [index];
  });
}

// A wrapper because TS otherwise carries stale "state !== closed" narrowing across an `await`.
function isDecoderClosed(decoder: VideoDecoder): boolean {
  return decoder.state === "closed";
}

function toEncodedVideoChunk(sample: Sample): EncodedVideoChunk | null {
  if (!sample.data) return null;
  return new EncodedVideoChunk({
    type: sample.is_sync ? "key" : "delta",
    timestamp: secondsToMicroseconds(sampleTimeSeconds(sample)),
    duration: secondsToMicroseconds(sample.duration / sample.timescale),
    data: sample.data,
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
  consume(frame: VideoFrame): void;
  // True once there is room for more decoded frames, false when no more are wanted.
  awaitRoom(): Promise<boolean>;
  // The next frame in plan order, or undefined once the stream has ended.
  take(): Promise<ImageBitmap | undefined>;
  end(): void;
  fail(reason: unknown): void;
  discard(): Promise<void>;
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
function captureCanvas(canvas: HTMLCanvasElement): Promise<ImageBitmap> {
  const capture = createImageBitmap(canvas);
  capture.catch(() => {});
  return capture;
}

async function closeWhenSettled(captures: Promise<ImageBitmap>[]): Promise<void> {
  for (const capture of await Promise.allSettled(captures)) {
    if (capture.status === "fulfilled") capture.value.close();
  }
}

// First frame at or after each wanted timestamp, as in the seek-based path (not nearest-frame).
export function createFrameCollector(
  wanted: number[],
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  cellW: number,
  cellH: number,
  rotation: number,
): FrameCollector {
  const captures: Promise<ImageBitmap>[] = [];
  const matcher = createFrameMatcher(wanted);
  const { changed, nextChange } = createChangeSignal();
  let ended = false;
  let discarded = false;
  let failure: { reason: unknown } | null = null;

  return {
    consume(frame) {
      if (discarded) return;
      const filled = matcher.fill(frame.timestamp / MICROSECONDS_PER_SECOND).length;
      for (let i = 0; i < filled; i++) {
        drawRotated(ctx, frame, cellW, cellH, rotation);
        captures.push(captureCanvas(canvas));
      }
      changed();
    },
    async awaitRoom() {
      while (!discarded && !failure && !matcher.done) {
        if (captures.length < MAX_BUFFERED_FRAMES) return true;
        await nextChange();
      }
      return false;
    },
    async take() {
      for (;;) {
        const capture = captures.shift();
        if (capture) {
          changed();
          return capture;
        }
        if (matcher.done) return undefined;
        if (failure) throw failure.reason;
        if (ended) return undefined;
        await nextChange();
      }
    },
    end() {
      ended = true;
      changed();
    },
    fail(reason) {
      failure ??= { reason };
      changed();
    },
    async discard() {
      discarded = true;
      changed();
      await closeWhenSettled(captures.splice(0));
    },
  };
}

async function feedSamples(
  decoder: VideoDecoder,
  samples: Sample[],
  indices: Iterable<number>,
  collector: FrameCollector,
): Promise<void> {
  for (const index of indices) {
    if (!(await collector.awaitRoom()) || isDecoderClosed(decoder)) return;
    const sample = samples[index];
    const chunk = sample && toEncodedVideoChunk(sample);
    if (!chunk) continue;
    if (decoder.decodeQueueSize > MAX_DECODE_QUEUE_SIZE) {
      await new Promise<void>((resolve) =>
        decoder.addEventListener("dequeue", () => resolve(), { once: true }),
      );
    }
    if (isDecoderClosed(decoder)) return;
    decoder.decode(chunk);
  }
  if (!isDecoderClosed(decoder)) await decoder.flush();
}

function* range(startIndex: number, endIndex: number): Generator<number> {
  for (let i = startIndex; i <= endIndex; i++) yield i;
}

function findDecodeStartIndex(samples: Sample[], startTime: number): number {
  let index = 0;
  for (const [i, sample] of samples.entries()) {
    if (sample.is_sync && sampleTimeSeconds(sample) <= startTime) index = i;
  }
  return index;
}

function findDecodeEndIndex(samples: Sample[], endTime: number): number {
  for (const [i, sample] of samples.entries()) {
    if (sample.dts / sample.timescale > endTime) {
      return Math.min(samples.length - 1, i + REORDER_PADDING_SAMPLES);
    }
  }
  return samples.length - 1;
}

export async function* decodeFrames(
  decoderConfig: VideoDecoderConfig,
  samples: Sample[],
  indices: Iterable<number>,
  wanted: number[],
  cell: { width: number; height: number },
  rotation: number,
): AsyncGenerator<ImageBitmap, void, undefined> {
  const { canvas, ctx } = createCellCanvas(cell.width, cell.height);
  const collector = createFrameCollector(wanted, canvas, ctx, cell.width, cell.height, rotation);
  const decoder = new VideoDecoder({
    output: (frame) => {
      try {
        collector.consume(frame);
      } finally {
        frame.close();
      }
    },
    error: (error) => collector.fail(error),
  });

  try {
    decoder.configure(decoderConfig);
    void feedSamples(decoder, samples, indices, collector).then(
      () => collector.end(),
      (err: unknown) => collector.fail(err),
    );
    for (let image = await collector.take(); image; image = await collector.take()) {
      yield image;
    }
  } finally {
    if (!isDecoderClosed(decoder)) decoder.close();
    await collector.discard();
  }
}

async function* noFrames(): AsyncGenerator<ImageBitmap, void, undefined> {}

export async function extractFramesWebCodecs(
  file: File,
  plan: RenderPlan,
): Promise<AsyncGenerator<ImageBitmap, void, undefined> | null> {
  if (typeof VideoDecoder === "undefined") return null;
  const firstFrame = plan.frames[0];
  const lastFrame = plan.frames.at(-1);
  if (!firstFrame || !lastFrame) return noFrames();

  const demuxed = await demuxCached(file);
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

  const wanted = plan.frames.map((frame) => frame.timestampSeconds);

  // Sync samples decode independently, so a keyframe-sampled plan never has to decode
  // the P/B frames in between.
  const keyframeIndices = selectKeyframeSampleIndices(samples, plan.frames);
  const indices =
    keyframeIndices ??
    range(
      findDecodeStartIndex(samples, firstFrame.timestampSeconds),
      findDecodeEndIndex(samples, lastFrame.timestampSeconds),
    );
  return decodeFrames(decoderConfig, samples, indices, wanted, plan.cell, rotation);
}
