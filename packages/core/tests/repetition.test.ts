import { describe, expect, it } from "vitest";
import { energyEnvelope } from "../src/audio/loudness";
import { repetitionRate } from "../src/audio/repetition";
import { pulseTrain, seededRandom, TEST_SAMPLE_RATE, tone } from "./audioSignals";

const envelopeOf = (samples: Float32Array) => energyEnvelope(samples, TEST_SAMPLE_RATE);

describe("repetitionRate", () => {
  it.each([30, 60, 120, 150])("finds a pulse train at %i per minute", (rate) => {
    const result = repetitionRate(envelopeOf(pulseTrain(12, rate)), 0, 12);

    expect(result?.ratePerMinute).toBeCloseTo(rate, 0);
    expect(result?.confidence).toBeGreaterThan(0.9);
  });

  it("reads the rate only inside the span it is given", () => {
    const envelope = envelopeOf(pulseTrain(20, 120));

    expect(repetitionRate(envelope, 5, 15)?.ratePerMinute).toBeCloseTo(120, 0);
  });

  it("finds nothing in a steady tone", () => {
    expect(repetitionRate(envelopeOf(tone(10, 0.5)), 0, 10)).toBeUndefined();
  });

  it("finds nothing in silence", () => {
    expect(
      repetitionRate(envelopeOf(new Float32Array(10 * TEST_SAMPLE_RATE)), 0, 10),
    ).toBeUndefined();
  });

  it("finds nothing in a span too short for three cycles of the fastest rate", () => {
    expect(repetitionRate(envelopeOf(pulseTrain(1, 120)), 0, 0.5)).toBeUndefined();
  });

  it("finds nothing when the loudness changes at random", () => {
    const random = seededRandom(7);
    const frameLength = TEST_SAMPLE_RATE / 100;
    const samples = new Float32Array(12 * TEST_SAMPLE_RATE);
    let amplitude = 0;
    samples.forEach((_, index) => {
      if (index % frameLength === 0) amplitude = random();
      samples[index] = amplitude * Math.sin(index);
    });

    expect(repetitionRate(envelopeOf(samples), 0, 12)).toBeUndefined();
  });

  it("ignores a rhythm slower than the range it looks in", () => {
    expect(repetitionRate(envelopeOf(pulseTrain(30, 6)), 0, 30)).toBeUndefined();
  });
});

describe("repetitionRate on changing loudness", () => {
  function jittered(amplitudeAt: (seconds: number) => number, jitterSeconds: number) {
    const random = seededRandom(11);
    const jitterLength = Math.round(jitterSeconds * TEST_SAMPLE_RATE);
    const samples = tone(20, 1);
    let jitter = 1;
    samples.forEach((sample, index) => {
      if (index % jitterLength === 0) jitter = 1 + 0.1 * (2 * random() - 1);
      samples[index] = sample * jitter * amplitudeAt(index / TEST_SAMPLE_RATE);
    });
    return envelopeOf(samples);
  }

  it.each([0.01, 0.1])("finds no rhythm in a swell with %f s jitter", (jitterSeconds) => {
    const swell = jittered((seconds) => 0.05 + (0.45 * seconds) / 20, jitterSeconds);

    expect(repetitionRate(swell, 0, 20)).toBeUndefined();
  });

  it("finds no rhythm in a sound that swells and then fades", () => {
    const rise = jittered((seconds) => 0.05 + 0.45 * (1 - Math.abs(seconds - 10) / 10), 0.1);

    expect(repetitionRate(rise, 0, 20)).toBeUndefined();
  });

  it("still finds a pulse train that grows louder", () => {
    const pulses = pulseTrain(20, 90);
    const growing = pulses.map((sample, index) => sample * (0.2 + index / pulses.length));

    expect(repetitionRate(envelopeOf(growing), 0, 20)?.ratePerMinute).toBeCloseTo(90, 0);
  });
});
