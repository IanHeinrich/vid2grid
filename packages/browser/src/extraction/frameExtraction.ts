import type { RenderPlan } from "@vid2grid/core";
import { extractFrames, type ExtractionProgress } from "./extractor";
import { looksLikeIsoBmff } from "./isoBmff";

/** Captures the plan's frames with the fastest strategy this browser and file allow. */
export async function extractFramesAuto(
  file: File,
  plan: RenderPlan,
  onProgress?: ExtractionProgress,
): Promise<ImageBitmap[]> {
  if (typeof VideoDecoder !== "undefined" && looksLikeIsoBmff(file)) {
    try {
      const { extractFramesWebCodecs } = await import("./webcodecsExtractor");
      const images = await extractFramesWebCodecs(file, plan, onProgress);
      if (images) return images;
    } catch {
      // Falls through to the seek-based extractor below.
    }
  }
  return extractFrames(file, plan, onProgress);
}
