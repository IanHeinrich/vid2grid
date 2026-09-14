import type { ProgressCallback, RenderPlan } from "@vid2grid/core";
import { extractFrames } from "./extractor";
import { supportsWebCodecs } from "./isoBmff";

export async function extractFramesAuto(
  file: File,
  plan: RenderPlan,
  onProgress?: ProgressCallback,
): Promise<ImageBitmap[]> {
  if (supportsWebCodecs(file)) {
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
