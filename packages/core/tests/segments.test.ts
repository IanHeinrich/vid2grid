import { describe, expect, it } from "vitest";
import { cuesFromSegments } from "../src/transcript/segments";

describe("cuesFromSegments", () => {
  it("puts each segment back on the video's timeline and trims its text", () => {
    expect(
      cuesFromSegments(
        [
          { start: 0, end: 1.5, text: " hello there" },
          { start: 2, end: 3, text: "general kenobi " },
        ],
        10,
      ),
    ).toEqual([
      { start: 10, end: 11.5, text: "hello there" },
      { start: 12, end: 13, text: "general kenobi" },
    ]);
  });

  it("ends an open-ended segment where it starts", () => {
    expect(cuesFromSegments([{ start: 4, end: null, text: "cut off" }], 1)).toEqual([
      { start: 5, end: 5, text: "cut off" },
    ]);
  });

  it("keeps a segment whose text trims to nothing", () => {
    expect(cuesFromSegments([{ start: 0, end: 1, text: "  " }], 0)).toEqual([
      { start: 0, end: 1, text: "" },
    ]);
  });
});
