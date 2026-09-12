import type { VideoInfo } from "@vid2grid/core";
import { waitForEvent } from "./extraction/extractor";

/**
 * Reads a video's duration and display dimensions from a `<video>` element's
 * metadata, which is cheap and works for every format the browser can play.
 */
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

/**
 * Counts the ISO-BMFF keyframes inside a time range, or `null` when the file
 * isn't demuxable (keyframe fast mode is then unavailable). mp4box is loaded
 * lazily so it stays out of the host's main bundle.
 */
export async function countKeyframesInRange(
  file: File,
  startTime: number,
  endTime: number,
): Promise<number | null> {
  const { countKeyframesInRange: countInDemuxedRange } =
    await import("./extraction/webcodecsExtractor");
  return countInDemuxedRange(file, startTime, endTime);
}
