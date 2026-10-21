import type { PortProgressCallback, RenderPlan } from "@vid2grid/core";
import { errorMessage } from "../shared/errors";
import { extractFrames } from "./extractor";
import { supportsWebCodecs } from "./isoBmff";

export async function extractFramesAuto(
  file: File,
  plan: RenderPlan,
  onProgress?: PortProgressCallback,
): Promise<ImageBitmap[]> {
  let webCodecsFailure: { reason: unknown } | null = null;
  if (supportsWebCodecs(file)) {
    try {
      const { extractFramesWebCodecs } = await import("./webcodecsExtractor");
      const images = await extractFramesWebCodecs(file, plan, onProgress);
      if (images) return images;
    } catch (err) {
      webCodecsFailure = { reason: err };
    }
  }
  return fallBackToSeeking(file, plan, onProgress, webCodecsFailure);
}

async function fallBackToSeeking(
  file: File,
  plan: RenderPlan,
  onProgress: PortProgressCallback | undefined,
  webCodecsFailure: { reason: unknown } | null,
): Promise<ImageBitmap[]> {
  try {
    return await extractFrames(file, plan, onProgress);
  } catch (seekFailure) {
    if (!webCodecsFailure) throw seekFailure;
    throw new AggregateError(
      [webCodecsFailure.reason, seekFailure],
      `${errorMessage(seekFailure)} (the WebCodecs path had already failed: ${errorMessage(webCodecsFailure.reason)})`,
      { cause: seekFailure },
    );
  }
}
