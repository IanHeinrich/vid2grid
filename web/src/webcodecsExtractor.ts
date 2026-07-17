/**
 * Fast frame extraction via WebCodecs `VideoDecoder` + mp4box.js demuxing.
 *
 * The seek-based extractor (extractor.ts) re-decodes from the nearest keyframe
 * for every single sampled frame, which dominates processing time. This module
 * demuxes the ISO-BMFF container once, decodes the relevant sample range
 * sequentially, and picks off the frames closest to each wanted timestamp as
 * they stream out of the decoder - one continuous decode pass instead of one
 * seek-and-decode per frame.
 *
 * Returns `null` whenever the container/codec isn't supported (or anything
 * else goes wrong) so the caller can transparently fall back to the seek-based
 * extractor. Never assumes the input is decodable.
 */
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
import type { CollageRequest } from "./types";
import type { GridLayout } from "./gridMaths";
import type { ExtractedFrame, ExtractionProgress } from "./extractor";

// Generous upper bound on B-frame reorder depth: how many extra samples (in
// decode order) past the last wanted timestamp we still feed the decoder, so
// composition-order reordering doesn't cause us to cut off a wanted frame.
const REORDER_PADDING_SAMPLES = 16;
// How many chunks may be queued in the decoder before we pause feeding it,
// to bound memory use on long clips instead of queuing the whole video at once.
const MAX_DECODE_QUEUE_SIZE = 30;

export function looksLikeIsoBmff(file: File): boolean {
  const name = file.name.toLowerCase();
  return (
    file.type === "video/mp4" ||
    file.type === "video/quicktime" ||
    name.endsWith(".mp4") ||
    name.endsWith(".m4v") ||
    name.endsWith(".mov")
  );
}

interface DemuxResult {
  videoTrack: Track;
  description: Uint8Array;
  samples: Sample[];
  durationSeconds: number;
  /** Container display rotation (tkhd matrix) in degrees clockwise: 0, 90, 180 or 270. */
  rotation: number;
}

// The seek-based <video> path gets rotation applied by the browser for free;
// VideoDecoder emits raw coded frames, so we read the track's tkhd display
// matrix and re-apply it ourselves. Matrix elements a,b (indices 0,1) are
// 16.16 fixed point; atan2(b, a) recovers the clockwise rotation (y-down) and
// matches ffmpeg's av_display_rotation_get. Snapped to the nearest right angle
// (0/90/180/270).
export function rotationFromMatrix(matrix: Matrix): number {
  const a = matrix[0] / 65536;
  const b = matrix[1] / 65536;
  const degrees = Math.round(Math.atan2(b, a) * (180 / Math.PI) / 90) * 90;
  return ((degrees % 360) + 360) % 360;
}

// Demuxing is independent of the collage settings, so cache it per File to make
// regenerating the same video with different settings cheap. Keyed by File
// identity (WeakMap) so a re-picked file re-parses and old entries are GC'd.
const demuxCache = new WeakMap<File, Promise<DemuxResult | null>>();

function demuxCached(file: File): Promise<DemuxResult | null> {
  let cached = demuxCache.get(file);
  if (!cached) {
    cached = demux(file).catch((err: unknown) => {
      // Don't let a failed parse permanently poison the cache entry - a retry
      // (e.g. after a transient error) should get a fresh attempt.
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
    // Skip the 8-byte box header (4-byte size + 4-byte fourcc): VideoDecoder
    // wants just the codec-specific configuration payload.
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
            durationSeconds: movie.duration / movie.timescale,
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

function buildWantedTimestamps(config: CollageRequest, videoDurationSeconds: number): number[] {
  const duration = config.endTime - config.startTime;
  const frameCount = Math.max(1, Math.floor(duration * config.targetFps));
  const timestamps: number[] = [];
  for (let i = 0; i < frameCount; i++) {
    const timestamp = config.startTime + i / config.targetFps;
    if (timestamp >= videoDurationSeconds) break;
    timestamps.push(timestamp);
  }
  return timestamps;
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

// A tiny wrapper so TS doesn't (incorrectly) carry "state !== closed" narrowing
// across the `await` between the two closed-state checks in the feed loop below.
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

// Draws a decoded frame into the (already display-oriented) cell, rotating it to
// undo the container's coded-vs-display rotation. For 90/270 the cell's width and
// height are swapped in the rotated frame, so the draw extents are swapped too.
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
  settle(): Promise<ExtractedFrame[]>;
}

/**
 * Draws each decoded frame into the cell-sized canvas and keeps the first frame
 * at/after each wanted timestamp - mirroring the seek-based extractor's "seek to
 * time T" semantics rather than true nearest-frame matching. Captures run async
 * (createImageBitmap), so `settle()` waits for them before returning.
 */
function createFrameCollector(
  wanted: number[],
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  cellW: number,
  cellH: number,
  rotation: number,
  onProgress?: ExtractionProgress,
): FrameCollector {
  const frames: (ExtractedFrame | undefined)[] = new Array(wanted.length);
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
          createImageBitmap(canvas).then((bitmap) => {
            frames[capturedIndex] = { timestamp: wanted[capturedIndex], frameIndex: capturedIndex, bitmap };
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
      const contiguous: ExtractedFrame[] = [];
      for (const frame of frames) {
        if (!frame) break;
        contiguous.push(frame);
      }
      return contiguous;
    },
  };
}

async function feedDecoder(
  decoder: VideoDecoder,
  samples: Sample[],
  startIndex: number,
  endIndex: number,
  shouldStop: () => boolean,
): Promise<void> {
  for (let i = startIndex; i <= endIndex; i++) {
    if (shouldStop()) break;
    if (isDecoderClosed(decoder)) break;
    const chunk = toEncodedVideoChunk(samples[i]);
    if (!chunk) continue;
    if (decoder.decodeQueueSize > MAX_DECODE_QUEUE_SIZE) {
      await new Promise<void>((resolve) => decoder.addEventListener("dequeue", () => resolve(), { once: true }));
    }
    if (isDecoderClosed(decoder)) break;
    decoder.decode(chunk);
  }
  if (!isDecoderClosed(decoder)) await decoder.flush();
}

/**
 * Decodes [startIndex, endIndex] into the collector, returning once every wanted
 * frame is captured, the samples run out, or the decoder errors - whichever
 * comes first. Racing `collector.completed` lets us stop early even while
 * `feedDecoder` is parked waiting for decode-queue backpressure to ease.
 */
async function decodeSampleRange(
  decoderConfig: VideoDecoderConfig,
  samples: Sample[],
  startIndex: number,
  endIndex: number,
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
      feedDecoder(decoder, samples, startIndex, endIndex, collector.isComplete),
      collector.completed,
      failed,
    ]);
  } finally {
    if (!isDecoderClosed(decoder)) decoder.close();
  }
}

export async function extractFramesWebCodecs(
  config: CollageRequest,
  layout: GridLayout | undefined,
  onProgress?: ExtractionProgress,
): Promise<ExtractedFrame[] | null> {
  if (typeof VideoDecoder === "undefined") return null;

  const demuxed = await demuxCached(config.videoFile);
  if (!demuxed) return null;
  const { videoTrack, description, samples, durationSeconds, rotation } = demuxed;

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

  const wanted = buildWantedTimestamps(config, durationSeconds);
  if (wanted.length === 0) return [];

  // When no layout is supplied the cell defaults to the frame's own size, which
  // is the *display* size - so swap coded dims for 90/270 rotations.
  const swapsDimensions = rotation === 90 || rotation === 270;
  const fallbackW = swapsDimensions ? codedHeight : codedWidth;
  const fallbackH = swapsDimensions ? codedWidth : codedHeight;
  const cellW = layout?.cellW ?? fallbackW;
  const cellH = layout?.cellH ?? fallbackH;
  const cell = createCellCanvas(cellW, cellH);
  if (!cell) return null;

  const collector = createFrameCollector(wanted, cell.canvas, cell.ctx, cellW, cellH, rotation, onProgress);
  const startIndex = findDecodeStartIndex(samples, config.startTime);
  const endIndex = findDecodeEndIndex(samples, config.endTime);

  await decodeSampleRange(decoderConfig, samples, startIndex, endIndex, collector);

  return collector.settle();
}
