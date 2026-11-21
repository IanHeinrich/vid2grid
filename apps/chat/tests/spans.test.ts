import { describe, expect, it } from "vitest";
import { mergeSpans } from "../src/spans";

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
