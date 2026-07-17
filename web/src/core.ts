import type { CollageRequest } from "./types";
import { getVideoMetadata, type ExtractedFrame, type ExtractionProgress } from "./extractor";
import { extractFramesAuto } from "./frameExtraction";
import { computeOptimalGrid, type GridLayout } from "./gridMaths";
import { GUTTER_PX, type CollageSheetInput, type TimestampFormat } from "./renderer";
import { renderSheetsToBlobs } from "./sheetRenderer";

export type GenerationPhase = "extracting" | "rendering";

/** Lightweight per-phase timing, surfaced via `onTiming` for profiling. */
export interface GenerationTimings {
  extractMs: number;
  renderMs: number;
  frameCount: number;
  sheetCount: number;
}

export interface GenerateCollagesOptions {
  onProgress?: (phase: GenerationPhase, done: number, total: number) => void;
  onTiming?: (timings: GenerationTimings) => void;
  /**
   * Source pixel aspect ratio (width / height), when the caller already knows it
   * from reading the video's metadata - avoids re-reading it here just to lay out
   * the grid. Ignored when a stub extractor is injected.
   */
  sourceAspect?: number;
  /**
   * Opt-in fast mode: decode only the keyframe nearest each sampled timestamp
   * (WebCodecs path only), trading exact-time frames for far less decode work.
   */
  keyframeSampling?: boolean;
  /** Injectable for tests - defaults to the real <video>/<canvas> based extractor. */
  extractFramesImpl?: (
    config: CollageRequest,
    onProgress?: ExtractionProgress,
    layout?: GridLayout,
    keyframeSampling?: boolean,
  ) => Promise<ExtractedFrame[]>;
}

export async function generateCollages(
  config: CollageRequest,
  options: GenerateCollagesOptions = {},
): Promise<Blob[]> {
  const extract = options.extractFramesImpl ?? extractFramesAuto;

  // Computed up front (from the video's real dimensions) so the real extractor
  // can capture frames directly at their final cell size instead of at full
  // source resolution. Skipped when a stub extractor is injected (tests): the
  // stub doesn't use a real <video> element, and jsdom can't decode one anyway.
  let layout: GridLayout | undefined;
  if (!options.extractFramesImpl) {
    let sourceAspect = options.sourceAspect;
    if (sourceAspect === undefined || sourceAspect <= 0) {
      const metadata = await getVideoMetadata(config.videoFile);
      sourceAspect = metadata.width / metadata.height;
    }
    layout = computeOptimalGrid(config.framesPerGrid, sourceAspect, config.outputResolution, GUTTER_PX);
  }

  const extractStart = performance.now();
  const extracted = await extract(
    config,
    (done, total) => options.onProgress?.("extracting", done, total),
    layout,
    options.keyframeSampling,
  );
  const extractMs = performance.now() - extractStart;
  if (extracted.length === 0) return [];

  if (!layout) {
    const firstBitmap = extracted[0].bitmap;
    const sourceAspect = firstBitmap.width / firstBitmap.height;
    layout = computeOptimalGrid(config.framesPerGrid, sourceAspect, config.outputResolution, GUTTER_PX);
  }

  // Decided once for the whole batch (rather than per-frame) so every sheet uses a
  // consistent timestamp format instead of flipping components mid-batch.
  const lastTimestamp = extracted[extracted.length - 1].timestamp;
  const timestampFormat: TimestampFormat = {
    showHours: lastTimestamp >= 3600,
    showMinutes: lastTimestamp >= 60,
    showMilliseconds: config.targetFps > 1,
  };

  const sheets: CollageSheetInput[] = [];
  for (let start = 0; start < extracted.length; start += config.framesPerGrid) {
    const chunk = extracted.slice(start, start + config.framesPerGrid);
    sheets.push({
      bitmaps: chunk.map((f) => f.bitmap),
      timestamps: chunk.map((f) => f.timestamp),
      frameIndices: chunk.map((f) => f.frameIndex),
      layout,
      outputResolution: config.outputResolution,
      gutterPx: GUTTER_PX,
      timestampFormat,
    });
  }

  const renderStart = performance.now();
  const blobs = await renderSheetsToBlobs(sheets, config.jpegQuality, (done, total) =>
    options.onProgress?.("rendering", done, total),
  );
  const renderMs = performance.now() - renderStart;

  options.onTiming?.({
    extractMs,
    renderMs,
    frameCount: extracted.length,
    sheetCount: sheets.length,
  });

  return blobs;
}
