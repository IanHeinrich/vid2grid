import { describe, expect, it } from "vitest";
import { computeOptimalGrid, GUTTER_PX, type CollageSheetInput } from "@vid2grid/core";
import { renderSheetsToBlobs } from "../src/rendering/sheetRenderer";

// jsdom has neither `Worker` nor `OffscreenCanvas`, so only the main-thread fallback runs here.
const OUTPUT_RESOLUTION = 256;
const FRAMES_PER_SHEET = 4;

// jsdom has no ImageBitmap, and jest-canvas-mock's drawImage rejects anything but a
// real canvas-like element, so a mocked HTMLCanvasElement stands in.
function fakeImage(width: number, height: number): ImageBitmap {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas as unknown as ImageBitmap;
}

function sheetInput(imageCount: number): CollageSheetInput<ImageBitmap> {
  const layout = computeOptimalGrid(FRAMES_PER_SHEET, 640 / 480, OUTPUT_RESOLUTION, GUTTER_PX);
  return {
    images: Array.from({ length: imageCount }, () => fakeImage(layout.cellW, layout.cellH)),
    timestamps: Array.from({ length: imageCount }, (_, i) => i),
    frameIndices: Array.from({ length: imageCount }, (_, i) => i),
    layout,
    outputResolution: OUTPUT_RESOLUTION,
    gutterPx: GUTTER_PX,
    timestampFormat: { showHours: false, showMinutes: false, showMilliseconds: true },
  };
}

describe("renderSheetsToBlobs", () => {
  it("encodes every sheet as a non-empty JPEG blob", async () => {
    const blobs = await renderSheetsToBlobs([sheetInput(4), sheetInput(2)], 80);

    expect(blobs).toHaveLength(2);
    for (const blob of blobs) {
      expect(blob).toBeInstanceOf(Blob);
      expect(blob.type).toBe("image/jpeg");
      expect(blob.size).toBeGreaterThan(0);
    }
  });

  it("reports progress once per encoded sheet", async () => {
    const progress: [number, number][] = [];
    await renderSheetsToBlobs([sheetInput(4), sheetInput(4)], 80, (done, total) =>
      progress.push([done, total]),
    );

    expect(progress).toEqual([
      [1, 2],
      [2, 2],
    ]);
  });

  it("returns nothing for no sheets", async () => {
    expect(await renderSheetsToBlobs([], 80)).toEqual([]);
  });
});
