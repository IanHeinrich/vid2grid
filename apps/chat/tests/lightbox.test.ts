import { describe, expect, it } from "vitest";
import { cellAt, sheetGrid } from "../src/ui/lightbox";

describe("sheetGrid", () => {
  it("picks the columns that give the largest cells, like core's packing", () => {
    expect(sheetGrid(4, 16 / 9, 1000, 1000)).toMatchObject({ cols: 2, rows: 2, cellW: 488 });
    expect(sheetGrid(3, 9 / 16, 1000, 1000)).toMatchObject({ cols: 3, rows: 1 });
    expect(sheetGrid(4, 1, 10, 10)).toBeUndefined();
  });

  it("finds no grid on an image that is not a square sheet", () => {
    expect(sheetGrid(4, 16 / 9, 1000, 800)).toBeUndefined();
  });
});

describe("cellAt", () => {
  const grid = sheetGrid(4, 16 / 9, 1000, 1000);

  it("finds cells row by row and nothing outside the grid or past the last frame", () => {
    if (!grid) throw new Error("No grid");
    expect(cellAt(grid, 250, 300, 3)).toBe(0);
    expect(cellAt(grid, 750, 300, 3)).toBe(1);
    expect(cellAt(grid, 250, 600, 3)).toBe(2);
    expect(cellAt(grid, 750, 600, 3)).toBeNull();
    expect(cellAt(grid, 500, 50, 3)).toBeNull();
  });
});
