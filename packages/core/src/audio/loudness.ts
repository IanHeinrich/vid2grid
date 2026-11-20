import { clamp } from "../math";

export const ENVELOPE_FRAME_SECONDS = 0.01;
export const SILENCE_FLOOR_DB = -100;
// Digital silence would drag the median down and make every sound in a mostly silent clip loud.
export const LOUDNESS_GATE_DB = -70;
const DB_PER_POWER_DECADE = 10;
const MIN_POWER = 10 ** (SILENCE_FLOOR_DB / DB_PER_POWER_DECADE);

export interface EnergyEnvelope {
  frameSeconds: number;
  rms: Float32Array;
}

export function energyEnvelope(
  samples: Float32Array,
  sampleRate: number,
  frameSeconds = ENVELOPE_FRAME_SECONDS,
): EnergyEnvelope {
  const frameLength = Math.max(1, Math.round(frameSeconds * sampleRate));
  const rms = new Float32Array(Math.ceil(samples.length / frameLength));
  for (let frame = 0; frame < rms.length; frame++) {
    const start = frame * frameLength;
    const end = Math.min(samples.length, start + frameLength);
    let sumOfSquares = 0;
    for (let index = start; index < end; index++) {
      const sample = samples[index] ?? 0;
      sumOfSquares += sample * sample;
    }
    rms[frame] = Math.sqrt(sumOfSquares / (end - start));
  }
  return { frameSeconds: frameLength / sampleRate, rms };
}

export function envelopeFrames(
  envelope: EnergyEnvelope,
  startSeconds: number,
  endSeconds: number,
): Float32Array {
  const frameCount = envelope.rms.length;
  const first = clamp(Math.round(startSeconds / envelope.frameSeconds), 0, frameCount);
  const last = clamp(Math.round(endSeconds / envelope.frameSeconds), first, frameCount);
  return envelope.rms.subarray(first, last);
}

function powerToDb(power: number): number {
  return DB_PER_POWER_DECADE * Math.log10(Math.max(MIN_POWER, power));
}

export function medianLoudnessDb(envelope: EnergyEnvelope): number {
  const levels = Array.from(envelope.rms, (rms) => powerToDb(rms * rms))
    .filter((level) => level > LOUDNESS_GATE_DB)
    .sort((a, b) => a - b);
  const middle = Math.floor(levels.length / 2);
  const upper = levels[middle];
  if (upper === undefined) return SILENCE_FLOOR_DB;
  if (levels.length % 2 === 1) return upper;
  return ((levels[middle - 1] ?? upper) + upper) / 2;
}

export function spanLoudnessDb(
  envelope: EnergyEnvelope,
  startSeconds: number,
  endSeconds: number,
): number {
  const frames = envelopeFrames(envelope, startSeconds, endSeconds);
  if (frames.length === 0) return SILENCE_FLOOR_DB;
  let totalPower = 0;
  for (const rms of frames) totalPower += rms * rms;
  return powerToDb(totalPower / frames.length);
}
