import { describe, expect, it } from "vitest";
import type { ImageRef } from "../src/types";
import { imageCaption, sheetCellTimes, type SheetSource } from "../src/ui/captions";

function sheet(call: string, startSeconds: number, endSeconds: number, frameCount: number) {
  const source: SheetSource = {
    kind: "sheet",
    call,
    name: "grid_0002",
    startSeconds,
    endSeconds,
    frameCount,
  };
  return source;
}

function ref(source: ImageRef["source"]): ImageRef {
  return { id: "i", pinned: false, source };
}

describe("imageCaption", () => {
  it("says what produced a sheet instead of its file name", () => {
    expect(imageCaption(ref(sheet("overview", 0, 19, 20)))).toBe(
      "Overview · 0:00 to 0:19 · 20 frames",
    );
    expect(imageCaption(ref(sheet("look(60, 90)", 60, 90, 8)))).toBe(
      "look · 1:00 to 1:30 · 8 frames",
    );
    expect(imageCaption(ref(sheet("frames(0:42, 0:44, 0:51)", 42, 51, 3)))).toBe(
      "frames · 0:42, 0:44, 0:51",
    );
  });

  it("uses the file name for an upload", () => {
    expect(imageCaption(ref({ kind: "upload", name: "cat.png" }))).toBe("cat.png");
  });
});

describe("sheetCellTimes", () => {
  it("reads the exact times of a frames call", () => {
    expect(sheetCellTimes(sheet("frames(0:42, 0:44.5, 1:02:03)", 42, 3723, 3))).toEqual([
      42, 44.5, 3723,
    ]);
  });

  it("spaces other sheets evenly from first to last frame", () => {
    expect(sheetCellTimes(sheet("look(60, 90)", 60, 90, 4))).toEqual([60, 70, 80, 90]);
    expect(sheetCellTimes(sheet("overview", 5, 5, 1))).toEqual([5]);
  });
});
