import { describe, expect, it } from "vitest";
import { computeOptimalGrid } from "../src/gridMaths";

describe("computeOptimalGrid", () => {
  it("picks a 3x3 layout for 9 square-ish frames and centers it", () => {
    const layout = computeOptimalGrid(9, 4 / 3, 256, 8);

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
    expect(() => computeOptimalGrid(9, 1, 4, 8)).toThrow(/too small/);
  });

  it("rejects non-positive inputs", () => {
    expect(() => computeOptimalGrid(0, 1, 256, 8)).toThrow();
    expect(() => computeOptimalGrid(9, 0, 256, 8)).toThrow();
    expect(() => computeOptimalGrid(9, 1, 0, 8)).toThrow();
    expect(() => computeOptimalGrid(9, 1, 256, -1)).toThrow();
  });
});
