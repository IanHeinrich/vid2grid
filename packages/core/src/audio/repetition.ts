import { SECONDS_PER_MINUTE } from "../plan/timestampFormat";
import { envelopeFrames, type EnergyEnvelope } from "./loudness";

export const MIN_REPETITIONS_PER_MINUTE = 15;
export const MAX_REPETITIONS_PER_MINUTE = 180;
const MIN_REPETITION_CONFIDENCE = 0.5;
const MIN_CYCLES_IN_SPAN = 3;
// A steady sound's envelope barely moves, and correlating its float noise would invent a rhythm.
const MIN_ENVELOPE_VARIATION = 0.05;
// Subtracting a moving average this long removes fades and swells, which correlate at every lag.
const DETREND_WINDOW_SECONDS = 1;
// A real period stands clear of the trough before it; a slowly falling curve has no such dip.
const MIN_PEAK_PROMINENCE = 0.3;
// A rhythm also correlates at two and three periods, so the shortest lag nearly as strong as
// the best one is taken as the period.
const HARMONIC_PEAK_RATIO = 0.9;

export interface RepetitionRate {
  ratePerMinute: number;
  confidence: number;
}

function isVarying(frames: Float32Array): boolean {
  let sum = 0;
  for (const value of frames) sum += value;
  const mean = sum / frames.length;
  let sumOfSquares = 0;
  for (const value of frames) sumOfSquares += (value - mean) * (value - mean);
  return mean > 0 && Math.sqrt(sumOfSquares / frames.length) / mean >= MIN_ENVELOPE_VARIATION;
}

function detrended(frames: Float32Array, frameSeconds: number): Float64Array {
  const halfWindow = Math.max(1, Math.round(DETREND_WINDOW_SECONDS / frameSeconds / 2));
  const prefixSums = new Float64Array(frames.length + 1);
  frames.forEach((value, index) => {
    prefixSums[index + 1] = (prefixSums[index] ?? 0) + value;
  });
  return Float64Array.from(frames, (value, index) => {
    const from = Math.max(0, index - halfWindow);
    const to = Math.min(frames.length, index + halfWindow + 1);
    return value - ((prefixSums[to] ?? 0) - (prefixSums[from] ?? 0)) / (to - from);
  });
}

function correlationAt(values: Float64Array, lag: number): number {
  let cross = 0;
  let earlyEnergy = 0;
  let lateEnergy = 0;
  for (let index = 0; index + lag < values.length; index++) {
    const early = values[index] ?? 0;
    const late = values[index + lag] ?? 0;
    cross += early * late;
    earlyEnergy += early * early;
    lateEnergy += late * late;
  }
  const scale = Math.sqrt(earlyEnergy * lateEnergy);
  return scale > 0 ? cross / scale : 0;
}

function parabolicPeakOffset(before: number, peak: number, after: number): number {
  const curvature = before - 2 * peak + after;
  return curvature === 0 ? 0 : (before - after) / (2 * curvature);
}

function prominentPeaks(
  correlations: Float64Array,
  shortestLag: number,
  longestLag: number,
): number[] {
  const at = (lag: number): number => correlations[lag] ?? 0;
  const peaks: number[] = [];
  let trough = Number.POSITIVE_INFINITY;
  for (let lag = 1; lag <= longestLag; lag++) {
    trough = Math.min(trough, at(lag));
    const isPeak = at(lag) > at(lag - 1) && at(lag) >= at(lag + 1);
    if (lag >= shortestLag && isPeak && at(lag) - trough >= MIN_PEAK_PROMINENCE) peaks.push(lag);
  }
  return peaks;
}

export function repetitionRate(
  envelope: EnergyEnvelope,
  startSeconds: number,
  endSeconds: number,
): RepetitionRate | undefined {
  const frames = envelopeFrames(envelope, startSeconds, endSeconds);
  const shortestLag = Math.max(
    1,
    Math.floor(SECONDS_PER_MINUTE / MAX_REPETITIONS_PER_MINUTE / envelope.frameSeconds),
  );
  const longestLag = Math.min(
    Math.ceil(SECONDS_PER_MINUTE / MIN_REPETITIONS_PER_MINUTE / envelope.frameSeconds),
    Math.floor(frames.length / MIN_CYCLES_IN_SPAN),
  );
  if (longestLag <= shortestLag || !isVarying(frames)) return undefined;

  const values = detrended(frames, envelope.frameSeconds);
  const correlations = Float64Array.from({ length: longestLag + 2 }, (_, lag) =>
    correlationAt(values, lag),
  );
  const at = (lag: number): number => correlations[lag] ?? 0;
  const peaks = prominentPeaks(correlations, shortestLag, longestLag);
  const strongest = Math.max(...peaks.map(at));
  const period = peaks.find((lag) => at(lag) >= HARMONIC_PEAK_RATIO * strongest);
  if (period === undefined || at(period) < MIN_REPETITION_CONFIDENCE) return undefined;

  const refinedLag = period + parabolicPeakOffset(at(period - 1), at(period), at(period + 1));
  return {
    ratePerMinute: SECONDS_PER_MINUTE / (refinedLag * envelope.frameSeconds),
    confidence: at(period),
  };
}
