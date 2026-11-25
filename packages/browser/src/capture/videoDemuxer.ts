import { keyframesInRange, rotationFromMatrix } from "@vid2grid/core";
import { DataStream, Endianness, type ISOFile, type Track, type VisualSampleEntry } from "mp4box";
import { supportsWebCodecs } from "./isoBmff";
import { appendFragments, readMovie } from "./mp4Movie";
import {
  frameTimestampsFromSamples,
  keyframeTimestampsFromSamples,
  onPresentationClock,
  toVideoSample,
  type VideoSample,
} from "./videoSamples";

export interface DemuxedVideo {
  videoTrack: Track;
  description: Uint8Array;
  samples: VideoSample[];
  rotation: number;
}

// Demuxing is independent of the collage settings, so regenerating with new settings reuses it.
// Keyed by File identity so a re-picked file re-parses and old entries are collectable.
const demuxCache = new WeakMap<File, Promise<DemuxedVideo | null>>();

export function demuxCached(file: File): Promise<DemuxedVideo | null> {
  let cached = demuxCache.get(file);
  if (!cached) {
    cached = demux(file).catch((err: unknown) => {
      // A failed parse must not poison the entry: a retry should get a fresh attempt.
      demuxCache.delete(file);
      throw err;
    });
    demuxCache.set(file, cached);
  }
  return cached;
}

function getCodecDescription(isoFile: ISOFile, trackId: number): Uint8Array | undefined {
  const trak = isoFile.getTrackById(trackId);
  const entries = trak.mdia.minf.stbl.stsd.entries as VisualSampleEntry[];
  for (const entry of entries) {
    const box = entry.avcC ?? entry.hvcC ?? entry.vpcC ?? entry.av1C;
    if (!box) continue;
    const stream = new DataStream(undefined, 0, Endianness.BIG_ENDIAN);
    (box.write as (stream: DataStream) => void)(stream);
    // VideoDecoder wants the configuration payload alone, past the 8-byte box header.
    return new Uint8Array(stream.buffer, 8);
  }
  return undefined;
}

async function demux(file: File): Promise<DemuxedVideo | null> {
  const parsed = await readMovie(file);
  const videoTrack = parsed?.movie.videoTracks[0];
  if (!parsed || !videoTrack) return null;
  const description = getCodecDescription(parsed.isoFile, videoTrack.id);
  if (!description) return null;
  if (parsed.movie.isFragmented) await appendFragments(file, parsed);

  // A file cut short still lists the samples it lost.
  const samples = parsed.isoFile
    .getTrackSamplesInfo(videoTrack.id)
    .filter((sample) => sample.offset + sample.size <= file.size)
    .map(toVideoSample);
  if (samples.length === 0) return null;
  return {
    videoTrack,
    description,
    samples: onPresentationClock(samples, videoTrack),
    rotation: rotationFromMatrix(videoTrack.matrix),
  };
}

async function demuxedSamples(file: File): Promise<VideoSample[] | null> {
  if (!supportsWebCodecs(file)) return null;
  const demuxed = await demuxCached(file);
  return demuxed?.samples ?? null;
}

export async function readKeyframeTimestamps(file: File): Promise<number[] | null> {
  const samples = await demuxedSamples(file);
  return samples && keyframeTimestampsFromSamples(samples);
}

export async function readFrameTimestamps(file: File): Promise<number[] | null> {
  const samples = await demuxedSamples(file);
  return samples && frameTimestampsFromSamples(samples);
}

export async function countKeyframesInRange(
  file: File,
  startTime: number,
  endTime: number,
): Promise<number | null> {
  const timestamps = await readKeyframeTimestamps(file);
  return timestamps && keyframesInRange(timestamps, startTime, endTime).length;
}
