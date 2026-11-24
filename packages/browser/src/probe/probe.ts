import type { VideoInfo } from "@vid2grid/core";
import { supportsWebCodecs } from "../capture/isoBmff";
import { createVideoElement, waitForEvent } from "../capture/video";

export async function probeVideo(file: File): Promise<VideoInfo> {
  const video = createVideoElement("metadata");
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

  return { durationSeconds, width, height };
}

export async function readKeyframeTimes(file: File): Promise<number[] | undefined> {
  if (!supportsWebCodecs(file)) return undefined;
  const { readKeyframeTimestamps } = await import("../capture/videoDemuxer");
  return (await readKeyframeTimestamps(file)) ?? undefined;
}

export async function readFrameTimes(file: File): Promise<number[] | undefined> {
  if (!supportsWebCodecs(file)) return undefined;
  const { readFrameTimestamps } = await import("../capture/videoDemuxer");
  return (await readFrameTimestamps(file)) ?? undefined;
}

/** `null` when the file is declined by design; a demux failure rejects. Lazy import keeps mp4box
 * out of the main bundle. */
export async function countKeyframesInRange(
  file: File,
  startTime: number,
  endTime: number,
): Promise<number | null> {
  const { countKeyframesInRange: countInDemuxedRange } = await import("../capture/videoDemuxer");
  return countInDemuxedRange(file, startTime, endTime);
}
