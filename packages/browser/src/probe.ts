import type { ProbeOptions, VideoInfo } from "@vid2grid/core";
import { waitForEvent } from "./extraction/extractor";
import { supportsWebCodecs } from "./extraction/isoBmff";

export async function probeVideo(
  file: File,
  { keyframeTimestamps }: ProbeOptions,
): Promise<VideoInfo> {
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

  if (!keyframeTimestamps) return { durationSeconds, width, height };

  const keyframeTimestampsSeconds = await readKeyframeTimestampsIfAvailable(file);
  return {
    durationSeconds,
    width,
    height,
    ...(keyframeTimestampsSeconds ? { keyframeTimestampsSeconds } : {}),
  };
}

async function readKeyframeTimestampsIfAvailable(file: File): Promise<number[] | null> {
  if (!supportsWebCodecs(file)) return null;
  try {
    const { readKeyframeTimestamps } = await import("./extraction/webcodecsExtractor");
    return await readKeyframeTimestamps(file);
  } catch {
    // Losing the demuxer chunk costs keyframe mode, which falls back to sampling, not the probe.
    return null;
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
