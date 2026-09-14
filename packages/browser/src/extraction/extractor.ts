import type { RenderPlan } from "@vid2grid/core";

export type ExtractionProgress = (done: number, total: number) => void;

/** `currentTime` lands on the nearest frame, not the first at/after the timestamp: the one
 * place this path's semantics differ from the WebCodecs one. */
export async function extractFrames(
  file: File,
  plan: RenderPlan,
  onProgress?: ExtractionProgress,
): Promise<ImageBitmap[]> {
  const video = document.createElement("video");
  video.preload = "auto";
  video.muted = true;
  video.playsInline = true;
  const url = URL.createObjectURL(file);

  try {
    video.src = url;
    await waitForEvent(video, "loadedmetadata");

    // Cell-sized, not source-sized, so no frame is downscaled twice.
    const canvas = document.createElement("canvas");
    canvas.width = plan.cell.width;
    canvas.height = plan.cell.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D context unavailable");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    const images: ImageBitmap[] = [];
    for (const frame of plan.frames) {
      if (frame.timestampSeconds >= video.duration) break;

      await seekTo(video, frame.timestampSeconds);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      images.push(await createImageBitmap(canvas));
      onProgress?.(images.length, plan.frames.length);
    }
    return images;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function waitForEvent(target: HTMLVideoElement, event: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      target.removeEventListener(event, onEvent);
      target.removeEventListener("error", onError);
    };
    const onEvent = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error(`Video failed while waiting for ${event}`));
    };
    target.addEventListener(event, onEvent, { once: true });
    target.addEventListener("error", onError, { once: true });
  });
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
      reject(new Error("Video seek failed"));
    };
    video.addEventListener("seeked", onSeeked, { once: true });
    video.addEventListener("error", onError, { once: true });
    video.currentTime = time;
  });
}
