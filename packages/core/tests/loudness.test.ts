import { describe, expect, it } from "vitest";
import {
  energyEnvelope,
  envelopeFrames,
  medianLoudnessDb,
  SILENCE_FLOOR_DB,
  spanLoudnessDb,
} from "../src/audio/loudness";
import { concat, TEST_SAMPLE_RATE, tone } from "./audioSignals";

const sineDb = (amplitude: number) => 20 * Math.log10(amplitude / Math.SQRT2);

describe("energyEnvelope", () => {
  it("measures a steady sine at its RMS level in every frame", () => {
    const envelope = energyEnvelope(tone(1, 0.5), TEST_SAMPLE_RATE);

    expect(envelope.rms).toHaveLength(100);
    expect(envelope.frameSeconds).toBe(0.01);
    for (const rms of envelope.rms) expect(rms).toBeCloseTo(0.5 / Math.SQRT2, 4);
  });

  it("averages a short last frame over its own samples", () => {
    const envelope = energyEnvelope(Float32Array.from([1, 1, 1, 0.5]), 1, 3);

    expect(Array.from(envelope.rms)).toEqual([1, 0.5]);
  });
});

describe("loudness in dB", () => {
  it("puts a burst four times louder than the rest 12 dB above the median", () => {
    const envelope = energyEnvelope(concat(tone(4, 0.1), tone(2, 0.4)), TEST_SAMPLE_RATE);

    expect(medianLoudnessDb(envelope)).toBeCloseTo(sineDb(0.1), 2);
    expect(spanLoudnessDb(envelope, 4, 6) - medianLoudnessDb(envelope)).toBeCloseTo(12.04, 1);
  });

  it("leaves digital silence out of the median, so a lone sound in a silent clip is not loud", () => {
    const envelope = energyEnvelope(
      concat(new Float32Array(8 * TEST_SAMPLE_RATE), tone(2, 0.1)),
      TEST_SAMPLE_RATE,
    );

    expect(medianLoudnessDb(envelope)).toBeCloseTo(sineDb(0.1), 2);
    expect(spanLoudnessDb(envelope, 8, 10) - medianLoudnessDb(envelope)).toBeCloseTo(0, 1);
  });

  it("gates out frames at or under -70 dB but keeps quiet sound above it", () => {
    const envelope = { frameSeconds: 1, rms: Float32Array.from([0.0001, 0.0002, 0.001, 0.01]) };

    expect(medianLoudnessDb(envelope)).toBeCloseTo(-50, 4);
  });

  it("averages the middle two levels of an even frame count", () => {
    const envelope = { frameSeconds: 1, rms: Float32Array.from([0.1, 0.01, 1, 0.001]) };

    expect(medianLoudnessDb(envelope)).toBeCloseTo(-30, 4);
  });

  it("holds silence at the floor rather than minus infinity", () => {
    const envelope = energyEnvelope(new Float32Array(1600), TEST_SAMPLE_RATE);

    expect(medianLoudnessDb(envelope)).toBe(SILENCE_FLOOR_DB);
    expect(spanLoudnessDb(envelope, 0, 0.1)).toBe(SILENCE_FLOOR_DB);
  });

  it("gives empty audio and an empty span the floor", () => {
    const envelope = energyEnvelope(new Float32Array(0), TEST_SAMPLE_RATE);

    expect(medianLoudnessDb(envelope)).toBe(SILENCE_FLOOR_DB);
    expect(spanLoudnessDb(energyEnvelope(tone(1, 0.5), TEST_SAMPLE_RATE), 2, 3)).toBe(
      SILENCE_FLOOR_DB,
    );
  });
});

describe("envelopeFrames", () => {
  it("clamps a span to the envelope", () => {
    const envelope = { frameSeconds: 1, rms: Float32Array.from([1, 2, 3]) };

    expect(Array.from(envelopeFrames(envelope, -1, 10))).toEqual([1, 2, 3]);
    expect(Array.from(envelopeFrames(envelope, 2, 1))).toEqual([]);
  });
});
