import { describe, expect, it } from "vitest";
import { computeSheetWindows } from "../src/plan/sheetWindows";

describe("computeSheetWindows", () => {
  it("runs the first window from the start and the last to the end", () => {
    const windows = computeSheetWindows(
      [{ timestamps: [0, 0.5, 1, 1.5] }, { timestamps: [2, 2.5] }],
      0,
      3,
    );

    expect(windows).toEqual([
      { startSeconds: 0, endSeconds: 1.75, fileName: "grid_0001.vtt" },
      { startSeconds: 1.75, endSeconds: 3, fileName: "grid_0002.vtt" },
    ]);
  });

  it("splits each gap between sheets at its midpoint, leaving no overlap or hole", () => {
    const windows = computeSheetWindows(
      [{ timestamps: [1, 2] }, { timestamps: [4, 5] }, { timestamps: [8, 9] }],
      0,
      10,
    );

    expect(windows.map((window) => [window.startSeconds, window.endSeconds])).toEqual([
      [0, 3],
      [3, 6.5],
      [6.5, 10],
    ]);
  });

  it("rounds every boundary to whole microseconds", () => {
    const windows = computeSheetWindows([{ timestamps: [0] }, { timestamps: [1 / 3] }], 0, 1);

    expect(windows[0].endSeconds).toBe(0.166667);
    expect(windows[1].startSeconds).toBe(0.166667);
  });

  it("covers the whole range with a single sheet", () => {
    expect(computeSheetWindows([{ timestamps: [4, 5] }], 2, 8)).toEqual([
      { startSeconds: 2, endSeconds: 8, fileName: "grid_0001.vtt" },
    ]);
  });
});
