import { GUTTER_PX } from "@vid2grid/core";
import { clamp } from "../spans";
import type { ImageArea } from "../types";
import { cellAt, type CellGrid } from "./sheetCells";
import { AREA_SCALE, type Rect } from "./zoomArea";

export interface FrameArea {
  cellIndex: number;
  area: ImageArea;
  // The asked area also reached into other frames, which are left out.
  coveredMore: boolean;
}

function cellRect(grid: CellGrid, index: number): Rect {
  const col = index % grid.cols;
  const row = Math.floor(index / grid.cols);
  return {
    x: grid.offsetX + GUTTER_PX + col * (grid.cellW + GUTTER_PX),
    y: grid.offsetY + GUTTER_PX + row * (grid.cellH + GUTTER_PX),
    width: grid.cellW,
    height: grid.cellH,
  };
}

function overlaps(a: Rect, b: Rect): boolean {
  const across = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const down = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return across > 0 && down > 0;
}

function coversOthers(asked: Rect, grid: CellGrid, frameCount: number, chosen: number): boolean {
  for (let index = 0; index < frameCount; index++) {
    if (index !== chosen && overlaps(asked, cellRect(grid, index))) return true;
  }
  return false;
}

// Maps an area of a whole sheet to the one frame its centre is on; undefined off the frames.
export function frameAreaOnSheet(
  area: ImageArea,
  grid: CellGrid,
  sheetPx: number,
  frameCount: number,
): FrameArea | undefined {
  const px = (thousandths: number) => (thousandths / AREA_SCALE) * sheetPx;
  const asked: Rect = {
    x: px(area.left),
    y: px(area.top),
    width: px(area.right - area.left),
    height: px(area.bottom - area.top),
  };
  const centreX = asked.x + asked.width / 2;
  const centreY = asked.y + asked.height / 2;
  const cellIndex = cellAt(grid, centreX, centreY, frameCount);
  if (cellIndex === null) return undefined;
  const cell = cellRect(grid, cellIndex);
  const across = (x: number) => clamp(((x - cell.x) / cell.width) * AREA_SCALE, 0, AREA_SCALE);
  const down = (y: number) => clamp(((y - cell.y) / cell.height) * AREA_SCALE, 0, AREA_SCALE);
  return {
    cellIndex,
    area: {
      left: across(asked.x),
      top: down(asked.y),
      right: across(asked.x + asked.width),
      bottom: down(asked.y + asked.height),
    },
    coveredMore: coversOthers(asked, grid, frameCount, cellIndex),
  };
}
