import { describe, expect, it } from "vitest";
import { downsample } from "../src/capture/downsample";

const TO_RATE = 16000;

function tone(hertz: number, rate: number, seconds = 0.2): Float32Array {
  return Float32Array.from({ length: rate * seconds }, (_, i) =>
    Math.sin((2 * Math.PI * hertz * i) / rate),
  );
}

// The edges are left out: the kernel runs off the samples there.
function middle(samples: Float32Array): Float32Array {
  return samples.subarray(200, samples.length - 200);
}

function peak(samples: Float32Array): number {
  return samples.reduce((most, value) => Math.max(most, Math.abs(value)), 0);
}

describe("downsample", () => {
  it.each([48000, 44100, 22050])("keeps speech from %i Hz where it was", (rate) => {
    const output = downsample(tone(1000, rate), rate, TO_RATE);
    const expected = tone(1000, TO_RATE);

    expect(output).toHaveLength(expected.length);
    const errors = output.map((value, i) => value - (expected[i] ?? 0));
    expect(peak(middle(errors))).toBeLessThan(0.01);
  });

  it.each([48000, 44100])("takes out what %i Hz audio holds above the new rate", (rate) => {
    expect(peak(middle(downsample(tone(12000, rate), rate, TO_RATE)))).toBeLessThan(0.01);
  });

  it("leaves a constant level alone", () => {
    const output = middle(downsample(new Float32Array(9600).fill(0.5), 48000, TO_RATE));
    for (const value of output) expect(value).toBeCloseTo(0.5, 5);
  });

  it("refuses to raise a rate", () => {
    expect(() => downsample(new Float32Array(4), 8000, TO_RATE)).toThrow(RangeError);
  });
});
