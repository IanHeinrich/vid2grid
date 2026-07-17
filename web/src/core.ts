import type { CollageRequest } from "./types";
import { getVideoMetadata, type ExtractedFrame, type ExtractionProgress } from "./extractor";
import { extractFramesAuto } from "./frameExtraction";
import { computeOptimalGrid, type GridLayout } from "./gridMaths";
import {
  GUTTER_PX,
  resizeToCell,
  watermarkFrame,
  assembleCollage,
  canvasToJpegBlob,
  type TimestampFormat,
} from "./renderer";

export type GenerationPhase = "extracting" | "rendering";

export interface GenerateCollagesOptions {
  onProgress?: (phase: GenerationPhase, done: number, total: number) => void;
  /** Injectable for tests - defaults to the real <video>/<canvas> based extractor. */
  extractFramesImpl?: (
    config: CollageRequest,
    onProgress?: ExtractionProgress,
    layout?: GridLayout,
  ) => Promise<ExtractedFrame[]>;
}

export async function generateCollages(
  config: CollageRequest,
  options: GenerateCollagesOptions = {},
): Promise<HTMLCanvasElement[]> {
  const extract = options.extractFramesImpl ?? extractFramesAuto;

  // Computed up front (from the video's real dimensions) so the real extractor
  // can capture frames directly at their final cell size instead of at full
  // source resolution. Skipped when a stub extractor is injected (tests): the
  // stub doesn't use a real <video> element, and jsdom can't decode one anyway.
  let layout: GridLayout | undefined;
  if (!options.extractFramesImpl) {
    const metadata = await getVideoMetadata(config.videoFile);
    const sourceAspect = metadata.width / metadata.height;
    layout = computeOptimalGrid(config.framesPerGrid, sourceAspect, config.outputResolution, GUTTER_PX);
  }

  const extracted = await extract(
    config,
    (done, total) => options.onProgress?.("extracting", done, total),
    layout,
  );
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

  const collages: HTMLCanvasElement[] = [];
  const totalSheets = Math.ceil(extracted.length / config.framesPerGrid);
  for (let start = 0; start < extracted.length; start += config.framesPerGrid) {
    const chunk = extracted.slice(start, start + config.framesPerGrid);
    const cells = chunk.map((f) =>
      watermarkFrame(
        resizeToCell(f.bitmap, layout.cellW, layout.cellH),
        f.timestamp,
        f.frameIndex,
        timestampFormat,
      ),
    );
    const collage = assembleCollage(cells, layout, config.outputResolution, GUTTER_PX);
    collages.push(collage);
    options.onProgress?.("rendering", collages.length, totalSheets);
  }

  return collages;
}

export { canvasToJpegBlob };
