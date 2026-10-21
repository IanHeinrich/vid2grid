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
  type PortProgressCallback,
  type RenderPlan,
} from "@vid2grid/core";
import { createCellCanvas } from "../shared/canvas";
import { closeImages } from "../shared/images";
import { supportsWebCodecs } from "./isoBmff";

// Generous upper bound on B-frame reorder depth: without the padding, composition-order
// reordering could cut off a wanted frame at the end of the range.
const REORDER_PADDING_SAMPLES = 16;
// Bounds memory on long clips rather than queuing the whole video at once.
const MAX_DECODE_QUEUE_SIZE = 30;

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
  isComplete: () => boolean;
  completed: Promise<void>;
  settle(): Promise<ImageBitmap[]>;
  discard(): Promise<void>;
}

// First frame at or after each wanted timestamp, as in the seek-based path (not nearest-frame).
export function createFrameCollector(
  wanted: number[],
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  cellW: number,
  cellH: number,
  rotation: number,
  onProgress?: PortProgressCallback,
): FrameCollector {
  const images = new Array<ImageBitmap | undefined>(wanted.length);
  const pendingCaptures: Promise<void>[] = [];
  const matcher = createFrameMatcher(wanted);
  let capturedCount = 0;
  let complete = false;
  let markComplete!: () => void;
  const completed = new Promise<void>((resolve) => {
    markComplete = resolve;
  });

  return {
    consume(frame) {
      for (const capturedIndex of matcher.fill(frame.timestamp / MICROSECONDS_PER_SECOND)) {
        drawRotated(ctx, frame, cellW, cellH, rotation);
        pendingCaptures.push(
          createImageBitmap(canvas).then((image) => {
            images[capturedIndex] = image;
            capturedCount++;
            onProgress?.({ done: capturedCount, total: wanted.length });
          }),
        );
      }
      if (matcher.done && !complete) {
        complete = true;
        markComplete();
      }
    },
    isComplete: () => complete,
    completed,
    async settle() {
      const captures = await Promise.allSettled(pendingCaptures);
      const failed = captures.find((capture) => capture.status === "rejected");
      if (failed) {
        closeImages(images);
        throw failed.reason;
      }
      const prefix = contiguousPrefix(images);
      closeImages(images.slice(prefix.length));
      return prefix;
    },
    async discard() {
      await Promise.allSettled(pendingCaptures);
      closeImages(images);
    },
  };
}

function contiguousPrefix(images: (ImageBitmap | undefined)[]): ImageBitmap[] {
  const captured: ImageBitmap[] = [];
  for (const image of images) {
    if (!image) break;
    captured.push(image);
  }
  return captured;
}

async function feedSamples(
  decoder: VideoDecoder,
  samples: Sample[],
  indices: Iterable<number>,
  shouldStop: () => boolean,
): Promise<void> {
  for (const index of indices) {
    if (shouldStop()) break;
    if (isDecoderClosed(decoder)) break;
    const sample = samples[index];
    const chunk = sample && toEncodedVideoChunk(sample);
    if (!chunk) continue;
    if (decoder.decodeQueueSize > MAX_DECODE_QUEUE_SIZE) {
      await new Promise<void>((resolve) =>
        decoder.addEventListener("dequeue", () => resolve(), { once: true }),
      );
    }
    if (isDecoderClosed(decoder)) break;
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

// Racing collector.completed lets the pass stop early even while feedSamples is
// parked on decode-queue backpressure.
async function decodeIntoCollector(
  decoderConfig: VideoDecoderConfig,
  samples: Sample[],
  indices: Iterable<number>,
  collector: FrameCollector,
): Promise<void> {
  let onDecoderError!: (error: DOMException) => void;
  const failed = new Promise<never>((_, reject) => {
    onDecoderError = reject;
  });

  const decoder = new VideoDecoder({
    output: (frame) => {
      try {
        collector.consume(frame);
      } finally {
        frame.close();
      }
    },
    error: onDecoderError,
  });
  decoder.configure(decoderConfig);

  try {
    await Promise.race([
      feedSamples(decoder, samples, indices, collector.isComplete),
      collector.completed,
      failed,
    ]);
  } finally {
    if (!isDecoderClosed(decoder)) decoder.close();
  }
}

async function decodeToImages(
  decoderConfig: VideoDecoderConfig,
  samples: Sample[],
  indices: Iterable<number>,
  wanted: number[],
  cellW: number,
  cellH: number,
  rotation: number,
  onProgress?: PortProgressCallback,
): Promise<ImageBitmap[]> {
  const { canvas, ctx } = createCellCanvas(cellW, cellH);
  const collector = createFrameCollector(wanted, canvas, ctx, cellW, cellH, rotation, onProgress);
  try {
    await decodeIntoCollector(decoderConfig, samples, indices, collector);
  } catch (err) {
    await collector.discard();
    throw err;
  }
  return collector.settle();
}

export async function extractFramesWebCodecs(
  file: File,
  plan: RenderPlan,
  onProgress?: PortProgressCallback,
): Promise<ImageBitmap[] | null> {
  if (typeof VideoDecoder === "undefined") return null;
  const firstFrame = plan.frames[0];
  const lastFrame = plan.frames.at(-1);
  if (!firstFrame || !lastFrame) return [];

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

  const { width: cellW, height: cellH } = plan.cell;
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
  return decodeToImages(
    decoderConfig,
    samples,
    indices,
    wanted,
    cellW,
    cellH,
    rotation,
    onProgress,
  );
}
