// Decides which samples a sparse plan decodes, from their times alone.
import { secondsToMicroseconds } from "@vid2grid/core";
import { sampleTimeMicroseconds, type SyncSample } from "./videoSamples";

// Crossing two syncs means the jump skips at least one whole GOP.
const MIN_SYNCS_CROSSED = 2;
// A jump flushes the decoder, which costs about as much as decoding a few frames.
const MIN_SKIPPED_SAMPLES = 16;

// Decode-order indices, both inclusive.
export interface DecodeSpan {
  first: number;
  last: number;
}

export interface SpanPlanner {
  // The samples to decode for the planned times from `plannedIndex` up to the next jump, and at
  // least `extension` more, or null when the video ends before that time.
  next(plannedIndex: number, extension?: number): DecodeSpan | null;
  // What the decoder made of starting there.
  acceptSync(index: number): void;
  rejectSync(index: number): void;
  // Starts only where the decoder has started before, or else at the first sample.
  stopTryingSyncs(): void;
}

interface PresentedSample {
  index: number;
  microseconds: number;
  position: number;
}

function firstIndexWhere(length: number, matches: (index: number) => boolean): number {
  let low = 0;
  let high = length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (matches(middle)) high = middle;
    else low = middle + 1;
  }
  return low;
}

function createPresentation(samples: readonly SyncSample[]) {
  const times = samples.map(sampleTimeMicroseconds);
  const presented: PresentedSample[] = times
    .map((microseconds, index) => ({ index, microseconds, position: 0 }))
    .sort((a, b) => a.microseconds - b.microseconds);
  presented.forEach((sample, position) => {
    sample.position = position;
  });
  const timeOf = (index: number): number => times[index] ?? Number.NaN;

  return {
    timeOf,
    firstAtOrAfter: (microseconds: number): PresentedSample | undefined =>
      presented[
        firstIndexWhere(
          presented.length,
          (i) => (presented[i]?.microseconds ?? Infinity) >= microseconds,
        )
      ],
    // On to every frame shown up to the latest one decoded, so that a frame the decoder loses gives
    // way to the next one shown and not to a reference frame shown after that.
    throughLatestShown(target: PresentedSample, { first, last }: DecodeSpan): number {
      let decodedThrough = last;
      let latestShown = -Infinity;
      let { position } = target;
      for (let index = first; index <= decodedThrough; index++) {
        latestShown = Math.max(latestShown, timeOf(index));
        let shown = presented[position];
        while (shown && shown.microseconds <= latestShown) {
          decodedThrough = Math.max(decodedThrough, shown.index);
          shown = presented[++position];
        }
      }
      return decodedThrough;
    },
  };
}

function createSyncs(samples: readonly SyncSample[]) {
  const accepted = new Set<number>();
  let syncs = samples.flatMap((sample, index) => (sample.is_sync ? [index] : []));
  const countThrough = (index: number): number =>
    firstIndexWhere(syncs.length, (i) => (syncs[i] ?? Infinity) > index);

  return {
    countThrough,
    lastThrough(index: number, matches: (sync: number) => boolean): number | undefined {
      for (let i = countThrough(index) - 1; i >= 0; i--) {
        const sync = syncs[i];
        if (sync !== undefined && matches(sync)) return sync;
      }
      return undefined;
    },
    accept(index: number): void {
      accepted.add(index);
    },
    reject(index: number): void {
      syncs = syncs.filter((sync) => sync !== index);
    },
    keepAccepted(): void {
      syncs = syncs.filter((sync) => accepted.has(sync));
    },
  };
}

export function createSpanPlanner(
  samples: readonly SyncSample[],
  plannedSeconds: readonly number[],
): SpanPlanner {
  const presentation = createPresentation(samples);
  const syncs = createSyncs(samples);

  const sampleFor = (plannedIndex: number): PresentedSample | undefined => {
    const planned = plannedSeconds[plannedIndex];
    if (planned === undefined) return undefined;
    return presentation.firstAtOrAfter(secondsToMicroseconds(planned));
  };

  // A frame shown before the sync it follows leads an open GOP and needs the GOP before it too. So
  // a span's start is never after a frame it was planned for, and the frames its start leads, which
  // may not decode, are all too early to be picked.
  const startFor = ({ index, microseconds }: PresentedSample): number =>
    syncs.lastThrough(index, (sync) => presentation.timeOf(sync) <= microseconds) ?? 0;

  const isWorthAJump = (decodedThrough: number, start: number): boolean =>
    start - decodedThrough > MIN_SKIPPED_SAMPLES &&
    syncs.countThrough(start) - syncs.countThrough(decodedThrough) >= MIN_SYNCS_CROSSED;

  return {
    next(plannedIndex, extension = 0) {
      const target = sampleFor(plannedIndex);
      if (!target) return null;
      const first = startFor(target);
      let last = target.index;
      for (let i = plannedIndex + 1; i < plannedSeconds.length; i++) {
        const following = sampleFor(i);
        if (!following || isWorthAJump(last, startFor(following))) break;
        last = Math.max(last, following.index);
      }
      const extended = Math.min(last + extension, samples.length - 1);
      return { first, last: presentation.throughLatestShown(target, { first, last: extended }) };
    },
    acceptSync: (index) => syncs.accept(index),
    rejectSync: (index) => syncs.reject(index),
    stopTryingSyncs: () => syncs.keepAccepted(),
  };
}
