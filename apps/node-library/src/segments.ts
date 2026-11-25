export interface CaptureSegment {
  // Where ffmpeg seeks; it starts from the keyframe at or before this time.
  seekSeconds: number;
  plannedSeconds: number[];
}

// Measured: at 30 fps a new ffmpeg process costs what decoding 2 s of video does with large
// cells and 4 s with small ones, so skipping less than this can lose.
export const MIN_SKIPPED_SECONDS = 5;
const MIN_SKIPPED_FRAMES = 150;
// Reaches past an open GOP's leading frames, and the demuxers that seek by decode time.
const EARLIER_SEEK_SECONDS = 1;

export function minSkippedSeconds(framesPerSecond: number | undefined): number {
  if (framesPerSecond === undefined) return MIN_SKIPPED_SECONDS;
  return Math.max(MIN_SKIPPED_SECONDS, MIN_SKIPPED_FRAMES / framesPerSecond);
}

// Every seek worth trying: two for each planned time far from the one before.
export function seeksToTry(plannedSeconds: readonly number[], minSkipped: number): number[] {
  return plannedSeconds.flatMap((planned, i) => {
    const previous = plannedSeconds[i - 1];
    const isFar = previous !== undefined && planned - previous >= minSkipped;
    return isFar ? seeksFor(planned) : [];
  });
}

// A new segment starts where the keyframe a seek lands on leaves enough video undecoded
// behind it. landings holds that keyframe's time for each seek that found one.
export function splitIntoSegments(
  plannedSeconds: readonly number[],
  landings: ReadonlyMap<number, number>,
  minSkipped: number,
): CaptureSegment[] {
  const segments: CaptureSegment[] = [];
  let current: CaptureSegment | undefined;
  let previous = 0;
  for (const planned of plannedSeconds) {
    const seekSeconds = seeksFor(planned).find((seek) => {
      const landing = landings.get(seek);
      if (landing === undefined) return false;
      return landing <= planned && landing - previous >= minSkipped;
    });
    if (!current || seekSeconds !== undefined) {
      current = { seekSeconds: seekSeconds ?? planned, plannedSeconds: [] };
      segments.push(current);
    }
    current.plannedSeconds.push(planned);
    previous = planned;
  }
  return segments;
}

function seeksFor(planned: number): number[] {
  return [planned, planned - EARLIER_SEEK_SECONDS];
}
