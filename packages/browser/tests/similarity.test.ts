import { describe, expect, it } from "vitest";
import { meanDirection, similarityLogits, unitVector } from "../src/audio/similarity";

describe("similarityLogits", () => {
  it("scales the cosine similarity to each label, whatever the vectors' lengths", () => {
    const same = [5, 0];
    const across = [0, 1];
    const between = [1, 1];

    const logits = similarityLogits([2, 0], [same, across, between], 10);

    expect(logits[0]).toBeCloseTo(10);
    expect(logits[1]).toBeCloseTo(0);
    expect(logits[2]).toBeCloseTo(10 / Math.SQRT2);
  });

  it("gives a zero vector no similarity rather than NaN", () => {
    expect(similarityLogits([0, 0], [[1, 0]], 10)).toEqual([0]);
  });
});

describe("unitVector", () => {
  it("scales a vector to length one and leaves a zero vector at zero", () => {
    expect([...unitVector([3, 4])]).toEqual([expect.closeTo(0.6), expect.closeTo(0.8)]);
    expect([...unitVector([0, 0])]).toEqual([0, 0]);
  });
});

describe("meanDirection", () => {
  it("averages the vectors' directions, whatever their lengths, at length one", () => {
    const [x = 0, y = 0] = meanDirection([
      [10, 0],
      [0, 1],
    ]);

    expect(x).toBeCloseTo(Math.SQRT1_2);
    expect(y).toBeCloseTo(Math.SQRT1_2);
  });

  it("keeps a single vector's direction", () => {
    expect([...meanDirection([[0, 2]])]).toEqual([0, 1]);
  });
});
