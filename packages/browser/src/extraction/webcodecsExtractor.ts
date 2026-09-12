// One continuous decode pass, where extractor.ts re-decodes from a keyframe per sampled frame.
// Every entry point returns `null` on an undecodable input so the caller can fall back to it.
import {
  createFile,
  MP4BoxBuffer,
  DataStream,
  Endianness,
  type ISOFile,
  type Matrix,
  type Movie,
  type Sample,
  type Track,
  type VisualSampleEntry,
} from "mp4box";
import { roundToMicroseconds, type PlannedFrame, type RenderPlan } from "@vid2grid/core";
import type { ExtractionProgress } from "./extractor";
import { looksLikeIsoBmff } from "./isoBmff";

// Generous upper bound on B-frame reorder depth: without the padding, composition-order
// reordering could cut off a wanted frame at the end of the range.
const REORDER_PADDING_SAMPLES = 16;
// Bounds decoder memory on long clips instead of queuing the whole video.
const MAX_DECODE_QUEUE_SIZE = 30;

interface DemuxResult {
  videoTrack: Track;
  description: Uint8Array;
  samples: Sample[];
  rotation: number;
}

// VideoDecoder emits raw coded frames, so rotation the browser would apply for free on a
// <video> is ours to redo. Elements a,b are 16.16 fixed point, as in ffmpeg's av_display_rotation_get.
export function rotationFromMatrix(matrix: Matrix): number {
  const a = matrix[0] / 65536;
  const b = matrix[1] / 65536;
  const degrees = Math.round((Math.atan2(b, a) * (180 / Math.PI)) / 90) * 90;
  return ((degrees % 360) + 360) % 360;
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
    .map((sample) => roundToMicroseconds(sample.cts / sample.timescale))
    .sort((a, b) => a - b);
}

export async function readKeyframeTimestamps(file: File): Promise<number[] | null> {
  if (typeof VideoDecoder === "undefined" || !looksLikeIsoBmff(file)) return null;
  try {
    const demuxed = await demuxCached(file);
    if (!demuxed) return null;
    return keyframeTimestampsFromSamples(demuxed.samples);
  } catch {
    return null;
  }
}

export async function countKeyframesInRange(
  file: File,
  startTime: number,
  endTime: number,
): Promise<number | null> {
  const timestamps = await readKeyframeTimestamps(file);
  if (!timestamps) return null;
  return timestamps.filter((time) => time >= startTime && time <= endTime).length;
}

/** Every planned timestamp being a sync sample's own composition time is what identifies a
 * keyframe-sampled plan; `null` means the plan needs a full decode pass. */
export function selectKeyframeSampleIndices(
  samples: Sample[],
  frames: PlannedFrame[],
): number[] | null {
  if (frames.length === 0) return null;
  const indexByTime = new Map<number, number>();
  samples.forEach((sample, index) => {
    if (!sample.is_sync) return;
    const time = roundToMicroseconds(sample.cts / sample.timescale);
    if (!indexByTime.has(time)) indexByTime.set(time, index);
  });

  const indices: number[] = [];
  for (const frame of frames) {
    const index = indexByTime.get(frame.timestampSeconds);
    if (index === undefined) return null;
    indices.push(index);
  }
  return indices;
}

// A wrapper because TS otherwise carries stale "state !== closed" narrowing across an `await`.
function isDecoderClosed(decoder: VideoDecoder): boolean {
  return decoder.state === "closed";
}

function toEncodedVideoChunk(sample: Sample): EncodedVideoChunk | null {
  if (!sample.data) return null;
  return new EncodedVideoChunk({
    type: sample.is_sync ? "key" : "delta",
    timestamp: Math.round((sample.cts / sample.timescale) * 1e6),
    duration: Math.round((sample.duration / sample.timescale) * 1e6),
    data: sample.data,
  });
}

function createCellCanvas(
  width: number,
  height: number,
): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  return { canvas, ctx };
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

interface FrameCollector {
  consume(frame: VideoFrame): void;
  isComplete(): boolean;
  completed: Promise<void>;
  settle(): Promise<ImageBitmap[]>;
}

// Keeps the first frame at or after each wanted timestamp, matching the seek-based
// extractor's "seek to time T" semantics rather than true nearest-frame matching.
function createFrameCollector(
  wanted: number[],
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  cellW: number,
  cellH: number,
  rotation: number,
  onProgress?: ExtractionProgress,
): FrameCollector {
  const images: (ImageBitmap | undefined)[] = new Array(wanted.length);
  const pendingCaptures: Promise<void>[] = [];
  let wantedIndex = 0;
  let capturedCount = 0;
  let complete = false;
  let markComplete!: () => void;
  const completed = new Promise<void>((resolve) => {
    markComplete = resolve;
  });

  return {
    consume(frame) {
      while (wantedIndex < wanted.length && frame.timestamp / 1e6 >= wanted[wantedIndex]) {
        const capturedIndex = wantedIndex;
        drawRotated(ctx, frame, cellW, cellH, rotation);
        pendingCaptures.push(
          createImageBitmap(canvas).then((image) => {
            images[capturedIndex] = image;
            capturedCount++;
            onProgress?.(capturedCount, wanted.length);
          }),
        );
        wantedIndex++;
      }
      if (wantedIndex >= wanted.length && !complete) {
        complete = true;
        markComplete();
      }
    },
    isComplete: () => complete,
    completed,
    async settle() {
      await Promise.all(pendingCaptures);
      return contiguousPrefix(images);
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
    const chunk = toEncodedVideoChunk(samples[index]);
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
  for (let i = 0; i < samples.length; i++) {
    if (samples[i].is_sync && samples[i].cts / samples[i].timescale <= startTime) {
      index = i;
    }
  }
  return index;
}

function findDecodeEndIndex(samples: Sample[], endTime: number): number {
  for (let i = 0; i < samples.length; i++) {
    if (samples[i].dts / samples[i].timescale > endTime) {
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

// Sync samples decode independently, so the P/B frames the sparse sampling would discard
// need never be decoded at all.
async function decodeKeyframes(
  decoderConfig: VideoDecoderConfig,
  samples: Sample[],
  indices: number[],
  cellW: number,
  cellH: number,
  rotation: number,
  onProgress?: ExtractionProgress,
): Promise<ImageBitmap[]> {
  const cellCanvas = createCellCanvas(cellW, cellH);
  if (!cellCanvas) return [];

  const images: (ImageBitmap | undefined)[] = new Array(indices.length);
  const pendingCaptures: Promise<void>[] = [];
  let outputIndex = 0;
  let capturedCount = 0;

  let onDecoderError!: (error: DOMException) => void;
  const failed = new Promise<never>((_, reject) => {
    onDecoderError = reject;
  });

  const decoder = new VideoDecoder({
    output: (frame) => {
      const captureIndex = outputIndex++;
      try {
        drawRotated(cellCanvas.ctx, frame, cellW, cellH, rotation);
        pendingCaptures.push(
          createImageBitmap(cellCanvas.canvas).then((image) => {
            images[captureIndex] = image;
            capturedCount++;
            onProgress?.(capturedCount, indices.length);
          }),
        );
      } finally {
        frame.close();
      }
    },
    error: onDecoderError,
  });
  decoder.configure(decoderConfig);

  try {
    await Promise.race([feedSamples(decoder, samples, indices, () => false), failed]);
  } finally {
    if (!isDecoderClosed(decoder)) decoder.close();
  }

  await Promise.all(pendingCaptures);
  return contiguousPrefix(images);
}

export async function extractFramesWebCodecs(
  file: File,
  plan: RenderPlan,
  onProgress?: ExtractionProgress,
): Promise<ImageBitmap[] | null> {
  if (typeof VideoDecoder === "undefined") return null;
  if (plan.frames.length === 0) return [];

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

  const keyframeIndices = selectKeyframeSampleIndices(samples, plan.frames);
  if (keyframeIndices) {
    return decodeKeyframes(
      decoderConfig,
      samples,
      keyframeIndices,
      cellW,
      cellH,
      rotation,
      onProgress,
    );
  }

  const cellCanvas = createCellCanvas(cellW, cellH);
  if (!cellCanvas) return null;
  const collector = createFrameCollector(
    wanted,
    cellCanvas.canvas,
    cellCanvas.ctx,
    cellW,
    cellH,
    rotation,
    onProgress,
  );
  await decodeIntoCollector(
    decoderConfig,
    samples,
    range(
      findDecodeStartIndex(samples, wanted[0]),
      findDecodeEndIndex(samples, wanted[wanted.length - 1]),
    ),
    collector,
  );
  return collector.settle();
}
