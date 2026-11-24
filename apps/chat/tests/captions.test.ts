import { describe, expect, it } from "vitest";
import type { ImageRef } from "../src/types";
import type { SheetSource } from "../src/imageRefs";
import { imageCaption } from "../src/ui/conversation/captions";
import { sheetCellTimes } from "../src/video/sheetCells";

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

  it("names the moment or the image a zoom looks into", () => {
    const area = { left: 100, top: 200, right: 400, bottom: 500 };
    const moment: ImageRef["source"] = {
      kind: "zoom",
      name: "zoom(1:02.5, 100, 200, 400, 500)",
      target: { kind: "moment", seconds: 62.5, fileKey: "beach-key" },
      area,
      width: 600,
      height: 450,
    };
    const image: ImageRef["source"] = {
      kind: "zoom",
      name: "zoom(beach.jpg, 100, 200, 400, 500)",
      target: { kind: "image", id: "i1", name: "beach.jpg" },
      area,
      width: 600,
      height: 450,
    };
    expect(imageCaption(ref(moment))).toBe("Zoom · 1:02.5");
    expect(imageCaption(ref(image))).toBe("Zoom · beach.jpg");
  });
});

describe("sheetCellTimes", () => {
  it("reads the exact times of a frames call", () => {
    expect(sheetCellTimes(sheet("frames(0:42, 0:44.5, 1:02:03)", 42, 3723, 3))).toEqual([
      42, 44.5, 3723,
    ]);
  });

  it("uses the exact first and last times, since the call's labels are rounded", () => {
    expect(sheetCellTimes(sheet("frames(0:42.1, 0:44.5, 1:02)", 42.17, 62.04, 3))).toEqual([
      42.17, 44.5, 62.04,
    ]);
    expect(sheetCellTimes(sheet("frames(0:42.1)", 42.17, 42.17, 1))).toEqual([42.17]);
  });

  it("spaces other sheets evenly from first to last frame", () => {
    expect(sheetCellTimes(sheet("look(60, 90)", 60, 90, 4))).toEqual([60, 70, 80, 90]);
    expect(sheetCellTimes(sheet("overview", 5, 5, 1))).toEqual([5]);
  });
});
