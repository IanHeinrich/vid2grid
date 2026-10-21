import type { RenderPlan } from "@vid2grid/core";
import { errorMessage } from "../shared/errors";
import { extractFrames } from "./extractor";
import { supportsWebCodecs } from "./isoBmff";

export async function* extractFramesAuto(
  file: File,
  plan: RenderPlan,
): AsyncGenerator<ImageBitmap, void, undefined> {
  let yielded = 0;
  let webCodecsFailure: { reason: unknown } | null = null;
  if (supportsWebCodecs(file)) {
    try {
      const { extractFramesWebCodecs } = await import("./webcodecsExtractor");
      const images = await extractFramesWebCodecs(file, plan);
      if (images) {
        for await (const image of images) {
          yielded++;
          yield image;
        }
        return;
      }
    } catch (err) {
      webCodecsFailure = { reason: err };
    }
  }
  yield* fallBackToSeeking(file, plan, yielded, webCodecsFailure);
}

async function* fallBackToSeeking(
  file: File,
  plan: RenderPlan,
  fromFrame: number,
  webCodecsFailure: { reason: unknown } | null,
): AsyncGenerator<ImageBitmap, void, undefined> {
  try {
    yield* extractFrames(file, plan, fromFrame);
  } catch (seekFailure) {
    if (!webCodecsFailure) throw seekFailure;
    throw new AggregateError(
      [webCodecsFailure.reason, seekFailure],
      `${errorMessage(seekFailure)} (the WebCodecs path had already failed: ${errorMessage(webCodecsFailure.reason)})`,
      { cause: seekFailure },
    );
  }
}
