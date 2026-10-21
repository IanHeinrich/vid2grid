import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildRenderPlan, type SheetRenderJob } from "@vid2grid/core";
import { renderSheetsToBlobs } from "../src/render/sheetRenderer";

// jsdom has neither `Worker` nor `OffscreenCanvas`, so only the main-thread fallback runs
// here. Plan-to-job routing is core's to test; this asks whether a JPEG Blob comes back.
const PLAN = buildRenderPlan(
  {
    startSeconds: 0,
    endSeconds: 1,
    targetFps: 8,
    framesPerGrid: 4,
    outputResolution: 256,
    jpegQuality: 80,
  },
  { durationSeconds: 1, width: 640, height: 480 },
);

// jest-canvas-mock's drawImage validates its source is a real canvas-like
// element, and jsdom implements neither ImageBitmap nor createImageBitmap.
let closes: ReturnType<typeof vi.fn>[] = [];

function fakeImage(width: number, height: number): ImageBitmap {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const close = vi.fn();
  closes.push(close);
  return Object.assign(canvas, { close });
}

beforeEach(() => {
  closes = [];
});

afterEach(() => {
  vi.restoreAllMocks();
});

function job(sheetIndex: number, imageCount: number): SheetRenderJob<ImageBitmap> {
  const sheet = PLAN.sheets[sheetIndex];
  if (!sheet) throw new Error(`PLAN has no sheet ${sheetIndex}`);
  return {
    sheet,
    images: sheet.cells.map((_, i) =>
      i < imageCount ? fakeImage(PLAN.cell.width, PLAN.cell.height) : undefined,
    ),
  };
}

describe("renderSheetsToBlobs", () => {
  it("encodes every job as a non-empty JPEG blob", async () => {
    const blobs = await renderSheetsToBlobs(PLAN, [job(0, 4), job(1, 2)]);

    expect(blobs).toHaveLength(2);
    for (const blob of blobs) {
      expect(blob).toBeInstanceOf(Blob);
      expect(blob.type).toBe("image/jpeg");
      expect(blob.size).toBeGreaterThan(0);
    }
  });

  it("reports progress once per encoded sheet", async () => {
    const progress: [number, number][] = [];
    await renderSheetsToBlobs(PLAN, [job(0, 4), job(1, 4)], ({ done, total }) =>
      progress.push([done, total]),
    );

    expect(progress).toEqual([
      [1, 2],
      [2, 2],
    ]);
  });

  it("returns nothing for no jobs", async () => {
    expect(await renderSheetsToBlobs(PLAN, [])).toEqual([]);
  });

  it("closes each sheet's images once it is encoded", async () => {
    const jobs = [job(0, 4), job(1, 2)];

    await renderSheetsToBlobs(PLAN, jobs);

    expect(closes).toHaveLength(6);
    for (const close of closes) expect(close).toHaveBeenCalledTimes(1);
  });

  it("closes the images of the failed sheet and of every sheet it never reached", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) =>
      callback(null),
    );
    const jobs = [job(0, 4), job(1, 4)];

    await expect(renderSheetsToBlobs(PLAN, jobs)).rejects.toThrowError("Failed to encode JPEG");

    expect(closes).toHaveLength(8);
    for (const close of closes) expect(close).toHaveBeenCalledTimes(1);
  });
});
