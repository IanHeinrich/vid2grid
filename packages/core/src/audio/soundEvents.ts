import { medianLoudnessDb, spanLoudnessDb, type EnergyEnvelope } from "./loudness";
import { repetitionRate } from "./repetition";
import { mergeWindowScores, type ScoreMergeOptions, type WindowScores } from "./scores";

export interface SoundEvent {
  startSeconds: number;
  endSeconds: number;
  label: string;
  score: number;
  loudnessDb: number;
  ratePerMinute?: number;
}

export interface SoundEventOptions extends ScoreMergeOptions {
  offsetSeconds: number;
}

export function soundEvents(
  windows: readonly WindowScores[],
  labels: readonly string[],
  envelope: EnergyEnvelope,
  options: SoundEventOptions,
): SoundEvent[] {
  const medianDb = medianLoudnessDb(envelope);
  return mergeWindowScores(windows, labels, options).map((span) => {
    const repetition = repetitionRate(envelope, span.startSeconds, span.endSeconds);
    return {
      startSeconds: span.startSeconds + options.offsetSeconds,
      endSeconds: span.endSeconds + options.offsetSeconds,
      label: span.label,
      score: span.score,
      loudnessDb: spanLoudnessDb(envelope, span.startSeconds, span.endSeconds) - medianDb,
      ...(repetition ? { ratePerMinute: repetition.ratePerMinute } : {}),
    };
  });
}
