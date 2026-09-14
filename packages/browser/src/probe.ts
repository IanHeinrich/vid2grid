import type { VideoInfo } from "@vid2grid/core";
import { waitForEvent } from "./extraction/extractor";

export async function probeVideo(file: File): Promise<VideoInfo> {
  const video = document.createElement("video");
  video.preload = "metadata";
  const url = URL.createObjectURL(file);
  video.src = url;
  try {
    await waitForEvent(video, "loadedmetadata");
    return {
      durationSeconds: video.duration || 0,
      width: video.videoWidth,
      height: video.videoHeight,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** `null` when the file isn't demuxable. The import is lazy so mp4box stays out of the main bundle. */
export async function countKeyframesInRange(
  file: File,
  startTime: number,
  endTime: number,
): Promise<number | null> {
  const { countKeyframesInRange: countInDemuxedRange } =
    await import("./extraction/webcodecsExtractor");
  return countInDemuxedRange(file, startTime, endTime);
}
