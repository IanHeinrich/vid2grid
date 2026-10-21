import type { RenderPlan } from "@vid2grid/core";
import { createCellCanvas } from "../shared/canvas";
import { createVideoElement, releaseVideo, waitForEvent } from "./video";

/** `currentTime` lands on the nearest frame, not the first at/after the timestamp: the one
 * place this path's semantics differ from the WebCodecs one. */
export async function* extractFrames(
  file: File,
  plan: RenderPlan,
  fromFrame = 0,
): AsyncGenerator<ImageBitmap, void, undefined> {
  const video = createVideoElement("auto");
  const url = URL.createObjectURL(file);

  try {
    video.src = url;
    await waitForEvent(video, "loadedmetadata");

    // Cell-sized, not source-sized, so no frame is downscaled twice.
    const { canvas, ctx } = createCellCanvas(plan.cell.width, plan.cell.height);

    for (const frame of plan.frames.slice(fromFrame)) {
      if (frame.timestampSeconds >= video.duration) break;

      await seekTo(video, frame.timestampSeconds);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      yield await createImageBitmap(canvas);
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
