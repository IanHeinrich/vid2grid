import { describe, expect, it } from "vitest";
import { mergeSpans, sameSpans } from "../src/spans";

describe("mergeSpans", () => {
  it("merges overlapping and touching spans", () => {
    expect(
      mergeSpans(
        [
          { startSeconds: 50, endSeconds: 90 },
          { startSeconds: 0, endSeconds: 60 },
          { startSeconds: 200, endSeconds: 210 },
        ],
        0.5,
      ),
    ).toEqual([
      { startSeconds: 0, endSeconds: 90 },
      { startSeconds: 200, endSeconds: 210 },
    ]);
  });
});

describe("sameSpans", () => {
  it("is true only for the same spans in the same order", () => {
    const span = { startSeconds: 0, endSeconds: 60 };
    expect(sameSpans([span], [{ ...span }])).toBe(true);
    expect(sameSpans([span], [])).toBe(false);
    expect(sameSpans([span], [{ ...span, endSeconds: 61 }])).toBe(false);
  });
});
