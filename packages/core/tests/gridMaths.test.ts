import { describe, expect, it } from "vitest";
import { Vid2GridError } from "../src/errors";
import { cellOrigin, computeOptimalGrid, type GridParams } from "../src/grid/gridMaths";

const grid = (sourceAspect: number, outputResolution: number, gutterPx: number): GridParams => ({
  sourceAspect,
  outputResolution,
  gutterPx,
});

describe("computeOptimalGrid", () => {
  it("picks a 3x3 layout for 9 square-ish frames and centers it", () => {
    const layout = computeOptimalGrid(9, grid(4 / 3, 256, 8));

    expect(layout.cols).toBe(3);
    expect(layout.rows).toBe(3);
    expect(layout.cellW).toBeGreaterThan(0);
    expect(layout.cellH).toBeGreaterThan(0);

    const gridW = layout.cols * layout.cellW + (layout.cols + 1) * 8;
    const gridH = layout.rows * layout.cellH + (layout.rows + 1) * 8;
    expect(gridW).toBeLessThanOrEqual(256);
    expect(gridH).toBeLessThanOrEqual(256);
    expect(layout.offsetX).toBe(Math.floor((256 - gridW) / 2));
    expect(layout.offsetY).toBe(Math.floor((256 - gridH) / 2));
  });

  it("throws when the resolution is too small to fit any layout", () => {
    expect(() => computeOptimalGrid(9, grid(1, 4, 8))).toThrow(/too small/);
    expect(() => computeOptimalGrid(9, grid(1, 4, 8))).toThrow(Vid2GridError);
  });

  it("rejects non-positive inputs", () => {
    expect(() => computeOptimalGrid(0, grid(1, 256, 8))).toThrow();
    expect(() => computeOptimalGrid(9, grid(0, 256, 8))).toThrow();
    expect(() => computeOptimalGrid(9, grid(1, 0, 8))).toThrow();
    expect(() => computeOptimalGrid(9, grid(1, 256, -1))).toThrow();
  });
});

describe("cellOrigin", () => {
  const layout = computeOptimalGrid(4, grid(4 / 3, 512, 8));

  it("steps each cell by its size plus one gutter from the centred offset", () => {
    expect(layout).toMatchObject({ cols: 2, rows: 2, cellW: 244, cellH: 183, offsetX: 0 });
    expect([0, 1, 2, 3].map((index) => cellOrigin(layout, index, 8))).toEqual([
      { x: 8, y: 69 },
      { x: 260, y: 69 },
      { x: 8, y: 260 },
      { x: 260, y: 260 },
    ]);
  });
});
