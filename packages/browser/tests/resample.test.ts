import { describe, expect, it } from "vitest";
import { resampleLinear } from "../src/audio/resample";

describe("resampleLinear", () => {
  it("triples the rate by interpolating between neighbours", () => {
    const output = resampleLinear(Float32Array.from([0, 3, 6]), 16000, 48000);

    expect(Array.from(output)).toEqual([0, 1, 2, 3, 4, 5, 6, 6, 6]);
  });

  it("halves the rate by keeping every other sample", () => {
    expect(Array.from(resampleLinear(Float32Array.from([0, 1, 2, 3]), 2, 1))).toEqual([0, 2]);
  });

  it("copies at the same rate so the result can be transferred alone", () => {
    const input = Float32Array.from([1, 2]);

    const output = resampleLinear(input, 16000, 16000);

    expect(Array.from(output)).toEqual([1, 2]);
    expect(output.buffer).not.toBe(input.buffer);
  });
});
