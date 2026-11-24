import {
  isKeyframePlan,
  roundToMicroseconds,
  secondsToMicroseconds,
  type PlannedFrame,
} from "@vid2grid/core";
import type { Entry, Sample, Track } from "mp4box";

export type TimedSample = Pick<Sample, "cts" | "timescale">;
export type SyncSample = TimedSample & Pick<Sample, "is_sync">;

// What a decode needs of an mp4box sample, so the rest of the sample table can be collected.
export type VideoSample = SyncSample & Pick<Sample, "duration" | "offset" | "size">;

export function toVideoSample(sample: Sample): VideoSample {
  const { cts, duration, timescale, is_sync, offset, size } = sample;
  return { cts, duration, timescale, is_sync, offset, size };
}

export function sampleTimeSeconds(sample: TimedSample): number {
  return sample.cts / sample.timescale;
}

export function sampleTimeMicroseconds(sample: TimedSample): number {
  return secondsToMicroseconds(sampleTimeSeconds(sample));
}

interface PresentationStart {
  mediaTime: number;
  emptySeconds: number;
}

// Browsers apply the edit list, so currentTime 0 is the first edit's media time after any empty
// edits, not cts 0. B-frame encodes typically start the media two frames in.
function presentationStart(edits: Entry[] | undefined, movieTimescale: number): PresentationStart {
  let emptySeconds = 0;
  for (const edit of edits ?? []) {
    if (edit.media_time >= 0) return { mediaTime: edit.media_time, emptySeconds };
    emptySeconds += edit.segment_duration / movieTimescale;
  }
  return { mediaTime: 0, emptySeconds: 0 };
}

// Every time below is on this clock, so it matches the planned times and the seek-based path.
export function onPresentationClock<TSample extends TimedSample>(
  samples: readonly TSample[],
  track: Pick<Track, "edits" | "movie_timescale">,
): TSample[] {
  const { mediaTime, emptySeconds } = presentationStart(track.edits, track.movie_timescale);
  return samples.map((sample) => {
    const shift = Math.round(emptySeconds * sample.timescale) - mediaTime;
    return { ...sample, cts: sample.cts + shift };
  });
}

// Samples before the presentation starts decode but are never shown, so they are left out.
export function frameTimestampsFromSamples(samples: readonly TimedSample[]): number[] {
  return samples
    .map((sample) => roundToMicroseconds(sampleTimeSeconds(sample)))
    .filter((time) => time >= 0)
    .sort((a, b) => a - b);
}

/** Every sync sample's time from the presentation start on, ascending, rounded the way the
 * planner rounds. */
export function keyframeTimestampsFromSamples(samples: readonly SyncSample[]): number[] {
  return frameTimestampsFromSamples(samples.filter((sample) => sample.is_sync));
}

/** `null` means the plan is not keyframe-sampled and needs a full decode pass. */
export function selectKeyframeSampleIndices(
  samples: readonly SyncSample[],
  frames: PlannedFrame[],
): number[] | null {
  if (frames.length === 0 || !isKeyframePlan({ frames }, keyframeTimestampsFromSamples(samples))) {
    return null;
  }
  const indexByTime = new Map<number, number>();
  samples.forEach((sample, index) => {
    if (!sample.is_sync) return;
    const time = roundToMicroseconds(sampleTimeSeconds(sample));
    if (!indexByTime.has(time)) indexByTime.set(time, index);
  });
  return frames.flatMap((frame) => {
    const index = indexByTime.get(roundToMicroseconds(frame.timestampSeconds));
    return index === undefined ? [] : [index];
  });
}
