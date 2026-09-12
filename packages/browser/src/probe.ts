import type { VideoInfo } from "@vid2grid/core";
import { waitForEvent } from "./extraction/extractor";
import { looksLikeIsoBmff } from "./extraction/isoBmff";

/**
 * Duration and display dimensions come from a `<video>` element's metadata,
 * which is cheap and works for every format the browser can play; keyframe
 * times need the ISO-BMFF demuxer and are left out when it can't read the file.
 * mp4box is imported lazily so it stays out of the host's main bundle.
 */
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

/** The keyframe count the planning UI shows for the selected range, or `null` when unreadable. */
export async function countKeyframesInRange(
  file: File,
  startTime: number,
  endTime: number,
): Promise<number | null> {
  const { countKeyframesInRange: countInDemuxedRange } =
    await import("./extraction/webcodecsExtractor");
  return countInDemuxedRange(file, startTime, endTime);
}
