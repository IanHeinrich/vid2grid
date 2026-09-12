import type { CapturedFrame, CollageRequest } from "@vid2grid/core";

/** The final on-sheet size every captured frame is scaled to. */
export interface CellSize {
  width: number;
  height: number;
}

export type ExtractionProgress = (done: number, total: number) => void;

export async function extractFrames(
  file: File,
  config: CollageRequest,
  cell: CellSize,
  onProgress?: ExtractionProgress,
): Promise<CapturedFrame<ImageBitmap>[]> {
  const video = document.createElement("video");
  video.preload = "auto";
  video.muted = true;
  video.playsInline = true;
  const url = URL.createObjectURL(file);

  try {
    video.src = url;
    await waitForEvent(video, "loadedmetadata");

    const duration = config.endTime - config.startTime;
    const frameCount = Math.max(1, Math.floor(duration * config.targetFps));

    // Captures directly at the final cell size instead of full source
    // resolution, avoiding a large drawImage + createImageBitmap per frame
    // followed by a second downscale later in the render pipeline.
    const canvas = document.createElement("canvas");
    canvas.width = cell.width;
    canvas.height = cell.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D context unavailable");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    const frames: CapturedFrame<ImageBitmap>[] = [];
    for (let i = 0; i < frameCount; i++) {
      const timestamp = config.startTime + i / config.targetFps;
      if (timestamp >= video.duration) break;

      await seekTo(video, timestamp);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const image = await createImageBitmap(canvas);
      frames.push({ timestamp, frameIndex: i, image });
      onProgress?.(i + 1, frameCount);
    }
    return frames;
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
