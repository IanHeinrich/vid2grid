import { buildRenderPlan, requestFromOptions, type PlannedCell } from "@vid2grid/core";
import { describe, expect, it } from "vitest";
import type { ImageArea } from "../src/types";
import { frameAreaOnSheet } from "../src/video/sheetArea";
import { sheetGrid } from "../src/video/sheetCells";

const ASPECTS = [
  ["landscape", 1920, 1080],
  ["portrait", 1080, 1920],
  ["square", 720, 720],
  ["wide", 2560, 1080],
] as const;
const FRAME_COUNTS = [1, 2, 3, 4, 6, 9, 12, 16, 20];
const RESOLUTION = 1536;

function planFor(width: number, height: number, frames: number) {
  const info = { durationSeconds: 120, width, height };
  const request = requestFromOptions(
    { frameCount: frames, framesPerGrid: frames, outputResolution: RESOLUTION },
    info,
  );
  return buildRenderPlan(request, info);
}

function gridFor(width: number, height: number, frames: number) {
  const grid = sheetGrid(frames, width / height, RESOLUTION, RESOLUTION);
  if (!grid) throw new Error("No grid");
  return grid;
}

// Part of a planned cell, in thousandths of the sheet as a model would give it.
function partOfCell(cell: PlannedCell, part: ImageArea): ImageArea {
  const across = (share: number) => ((cell.x + (share / 1000) * cell.width) / RESOLUTION) * 1000;
  const down = (share: number) => ((cell.y + (share / 1000) * cell.height) / RESOLUTION) * 1000;
  return {
    left: across(part.left),
    top: down(part.top),
    right: across(part.right),
    bottom: down(part.bottom),
  };
}

const PART: ImageArea = { left: 200, top: 300, right: 600, bottom: 900 };

describe("frameAreaOnSheet on core's own plans", () => {
  for (const [name, width, height] of ASPECTS) {
    it.each(FRAME_COUNTS)(`finds every ${name} frame of a sheet of %i`, (frames) => {
      const sheet = planFor(width, height, frames).sheets[0];
      const grid = gridFor(width, height, frames);
      expect(sheet?.cells).toHaveLength(frames);
      sheet?.cells.forEach((cell, index) => {
        const found = frameAreaOnSheet(partOfCell(cell, PART), grid, RESOLUTION, frames);
        expect(found).toMatchObject({ cellIndex: index, coveredMore: false });
        expect(found?.area.left).toBeCloseTo(PART.left, 6);
        expect(found?.area.top).toBeCloseTo(PART.top, 6);
        expect(found?.area.right).toBeCloseTo(PART.right, 6);
        expect(found?.area.bottom).toBeCloseTo(PART.bottom, 6);
      });
    });
  }
});

describe("frameAreaOnSheet at the edges of a frame", () => {
  const cells = planFor(1920, 1080, 4).sheets[0]?.cells ?? [];
  const grid = gridFor(1920, 1080, 4);

  it("clamps to the frame in the middle and says when others were covered", () => {
    const whole = { left: 0, top: 0, right: 999, bottom: 999 };
    const found = frameAreaOnSheet(whole, grid, RESOLUTION, 4);
    expect(found).toMatchObject({ cellIndex: 0, coveredMore: true });
    expect(found?.area).toEqual({ left: 0, top: 0, right: 1000, bottom: 1000 });
  });

  it("does not count the gutter around a frame as another frame", () => {
    const second = cells[1];
    if (!second) throw new Error("No cell");
    const overhang = partOfCell(second, { left: -5, top: -5, right: 1000, bottom: 1000 });
    expect(frameAreaOnSheet(overhang, grid, RESOLUTION, 4)).toEqual({
      cellIndex: 1,
      area: { left: 0, top: 0, right: 1000, bottom: 1000 },
      coveredMore: false,
    });
  });

  it("finds nothing on the black bars", () => {
    const one = gridFor(1920, 1080, 1);
    const bar = { left: 0, top: 0, right: 1000, bottom: 100 };
    expect(frameAreaOnSheet(bar, one, RESOLUTION, 1)).toBeUndefined();
  });
});
