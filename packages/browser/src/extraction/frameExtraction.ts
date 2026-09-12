import type { CapturedFrame, CollageRequest } from "@vid2grid/core";
import { extractFrames, type CellSize, type ExtractionProgress } from "./extractor";

export async function extractFramesAuto(
  file: File,
  config: CollageRequest,
  cell: CellSize,
  keyframeSampling: boolean,
  onProgress?: ExtractionProgress,
): Promise<CapturedFrame<ImageBitmap>[]> {
  if (typeof VideoDecoder !== "undefined") {
    try {
      const { looksLikeIsoBmff, extractFramesWebCodecs } = await import("./webcodecsExtractor");
      if (looksLikeIsoBmff(file)) {
        const frames = await extractFramesWebCodecs(
          file,
          config,
          cell,
          onProgress,
          keyframeSampling,
        );
        if (frames) return frames;
      }
    } catch {
      // Falls through to the seek-based extractor below.
    }
  }
  return extractFrames(file, config, cell, onProgress);
}
