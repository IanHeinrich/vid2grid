import type { CollageRequest } from "../types";
import { extractFrames, type ExtractedFrame, type ExtractionProgress } from "./extractor";
import type { GridLayout } from "../grid/gridMaths";

/**
 * Picks the fastest available frame-extraction strategy.
 */
export async function extractFramesAuto(
  config: CollageRequest,
  onProgress: ExtractionProgress | undefined,
  layout: GridLayout | undefined,
  keyframeSampling?: boolean,
): Promise<ExtractedFrame[]> {
  if (typeof VideoDecoder !== "undefined") {
    try {
      const { looksLikeIsoBmff, extractFramesWebCodecs } = await import("./webcodecsExtractor");
      if (looksLikeIsoBmff(config.videoFile)) {
        const frames = await extractFramesWebCodecs(config, layout, onProgress, keyframeSampling);
        if (frames) return frames;
      }
    } catch {
      // Falls through to the seek-based extractor below.
    }
  }
  return extractFrames(config, onProgress, layout);
}
