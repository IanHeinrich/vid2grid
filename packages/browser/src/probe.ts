import type { VideoInfo } from "@vid2grid/core";
import { waitForEvent } from "./extraction/extractor";
import { looksLikeIsoBmff } from "./extraction/isoBmff";

export async function probeVideo(file: File): Promise<VideoInfo> {
  const video = document.createElement("video");
  video.preload = "metadata";
  const url = URL.createObjectURL(file);
  video.src = url;
  let durationSeconds: number;
  let width: number;
  let height: number;
  try {
    await waitForEvent(video, "loadedmetadata");
    durationSeconds = video.duration || 0;
    width = video.videoWidth;
    height = video.videoHeight;
  } finally {
    URL.revokeObjectURL(url);
  }

  const keyframeTimestampsSeconds = await readKeyframeTimestampsIfAvailable(file);
  return {
    durationSeconds,
    width,
    height,
    ...(keyframeTimestampsSeconds ? { keyframeTimestampsSeconds } : {}),
  };
}

async function readKeyframeTimestampsIfAvailable(file: File): Promise<number[] | null> {
  if (typeof VideoDecoder === "undefined" || !looksLikeIsoBmff(file)) return null;
  const { readKeyframeTimestamps } = await import("./extraction/webcodecsExtractor");
  return readKeyframeTimestamps(file);
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
