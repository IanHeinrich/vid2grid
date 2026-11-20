import { clamp } from "@vid2grid/core";
import type { Entry, Sample } from "mp4box";

// Decoders need a little audio before the range to settle; AAC and Opus both want under 0.1 s.
export const AUDIO_PREROLL_SECONDS = 0.1;

export type TimedSample = Pick<Sample, "cts" | "duration" | "timescale">;
export type StoredSample = TimedSample & Pick<Sample, "offset" | "size">;

export interface SampleSpan {
  first: number;
  end: number;
}

export interface ByteRun {
  offset: number;
  length: number;
  first: number;
  end: number;
}

export interface BoxHeader {
  type: string;
  size: number;
}

const BOX_SIZE_TO_END_OF_FILE = 0;
const BOX_SIZE_IS_64_BIT = 1;
const BOX_TYPE_OFFSET = 4;
const BOX_TYPE_LENGTH = 4;
const LARGE_SIZE_OFFSET = 8;
export const BOX_HEADER_BYTES = 8;
export const LARGE_BOX_HEADER_BYTES = 16;

// Browsers apply the edit list, so time 0 is the first edit's media time after any empty edits.
export function presentationOffsetSeconds(
  edits: Entry[] | undefined,
  movieTimescale: number,
  trackTimescale: number,
): number {
  let emptySeconds = 0;
  for (const edit of edits ?? []) {
    if (edit.media_time >= 0) return emptySeconds - edit.media_time / trackTimescale;
    emptySeconds += edit.segment_duration / movieTimescale;
  }
  return 0;
}

export function sampleSeconds(sample: TimedSample, offsetSeconds: number): number {
  return sample.cts / sample.timescale + offsetSeconds;
}

export function sampleEndSeconds(sample: TimedSample, offsetSeconds: number): number {
  return (sample.cts + sample.duration) / sample.timescale + offsetSeconds;
}

export function samplesForRange(
  samples: readonly TimedSample[],
  offsetSeconds: number,
  startSeconds: number,
  endSeconds: number,
  prerollSeconds = AUDIO_PREROLL_SECONDS,
): SampleSpan | null {
  const from = startSeconds - prerollSeconds;
  const first = samples.findIndex((sample) => sampleEndSeconds(sample, offsetSeconds) > from);
  if (first === -1) return null;
  let end = first;
  while (end < samples.length) {
    const sample = samples[end];
    if (!sample || sampleSeconds(sample, offsetSeconds) >= endSeconds) break;
    end++;
  }
  return end > first ? { first, end } : null;
}

// Consecutive samples stored back to back are read in one go, up to `maxBytes` per read.
export function byteRuns(
  samples: readonly StoredSample[],
  span: SampleSpan,
  maxBytes: number,
): ByteRun[] {
  const runs: ByteRun[] = [];
  let run: ByteRun | undefined;
  for (let index = span.first; index < span.end; index++) {
    const sample = samples[index];
    if (!sample) continue;
    const continues =
      run !== undefined &&
      sample.offset === run.offset + run.length &&
      run.length + sample.size <= maxBytes;
    if (run && continues) {
      run.length += sample.size;
      run.end = index + 1;
    } else {
      run = { offset: sample.offset, length: sample.size, first: index, end: index + 1 };
      runs.push(run);
    }
  }
  return runs;
}

// The result starts exactly at `startSeconds`, with silence wherever the audio does not reach.
export function trimToRange(
  samples: Float32Array,
  sampleRate: number,
  samplesStartSeconds: number,
  startSeconds: number,
  endSeconds: number,
): Float32Array {
  const length = Math.max(0, Math.round((endSeconds - startSeconds) * sampleRate));
  const output = new Float32Array(length);
  const leadingSilence = Math.round((samplesStartSeconds - startSeconds) * sampleRate);
  const writeAt = clamp(leadingSilence, 0, length);
  const readFrom = Math.max(0, -leadingSilence);
  output.set(samples.subarray(readFrom, readFrom + length - writeAt), writeAt);
  return output;
}

export function readBoxHeader(view: DataView, bytesToEndOfFile: number): BoxHeader | null {
  if (view.byteLength < BOX_HEADER_BYTES) return null;
  const typeCodes = Array.from({ length: BOX_TYPE_LENGTH }, (_, index) =>
    view.getUint8(BOX_TYPE_OFFSET + index),
  );
  const type = String.fromCharCode(...typeCodes);
  const declared = view.getUint32(0);
  if (declared === BOX_SIZE_TO_END_OF_FILE) return { type, size: bytesToEndOfFile };
  if (declared !== BOX_SIZE_IS_64_BIT) {
    return declared < BOX_HEADER_BYTES ? null : { type, size: declared };
  }
  if (view.byteLength < LARGE_BOX_HEADER_BYTES) return null;
  const size = Number(view.getBigUint64(LARGE_SIZE_OFFSET));
  return size < LARGE_BOX_HEADER_BYTES ? null : { type, size };
}
