import type { AbortSignalLike, RenderPlan } from "@vid2grid/core";
import { createFrameCanvas } from "../shared/canvas";
import { throwIfAborted, untilAborted } from "./abort";
import { createVideoElement, releaseVideo, waitForEvent } from "./video";

/** `currentTime` lands on the nearest frame, not the first at/after the timestamp: the one
 * place this path's semantics differ from the WebCodecs one. */
export async function* extractFrames(
  file: File,
  plan: RenderPlan,
  fromFrame = 0,
  signal?: AbortSignalLike,
): AsyncGenerator<ImageBitmap, void, undefined> {
  throwIfAborted(signal);
  const video = createVideoElement("auto");
  const url = URL.createObjectURL(file);

  try {
    video.src = url;
    await untilAborted(waitForEvent(video, "loadedmetadata"), signal);

    // Cell-sized, not source-sized, so no frame is downscaled twice.
    const { canvas, ctx, capture } = createFrameCanvas(plan.cell, plan.crop);

    for (const frame of plan.frames.slice(fromFrame)) {
      if (frame.timestampSeconds >= video.duration) break;

      throwIfAborted(signal);
      await untilAborted(seekTo(video, frame.timestampSeconds), signal);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      yield await capture();
    }
  } finally {
    releaseVideo(video);
    URL.revokeObjectURL(url);
  }
}

function seekTo(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("error", onError);
    };
    const onSeeked = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("Video seek failed", { cause: video.error }));
    };
    video.addEventListener("seeked", onSeeked, { once: true });
    video.addEventListener("error", onError, { once: true });
    video.currentTime = time;
  });
}
