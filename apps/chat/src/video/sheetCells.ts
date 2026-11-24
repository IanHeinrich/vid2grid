import { computeOptimalGrid, GUTTER_PX, type GridLayout } from "@vid2grid/core";
import type { SheetSource } from "../imageRefs";
import { findTimestamps } from "../time";

export const LISTED_CALL = /^(frames?)\((.*)\)$/;

export type CellGrid = GridLayout;

// Sheets are square, so an image of any other shape is not one core laid out.
export function sheetGrid(
  frameCount: number,
  aspect: number,
  width: number,
  height: number,
): CellGrid | undefined {
  if (width !== height) return undefined;
  try {
    return computeOptimalGrid(frameCount, {
      sourceAspect: aspect,
      outputResolution: width,
      gutterPx: GUTTER_PX,
    });
  } catch {
    return undefined;
  }
}

function axisCell(position: number, offset: number, cell: number, count: number): number | null {
  const span = count * cell + (count + 1) * GUTTER_PX;
  if (position < offset || position > offset + span) return null;
  const index = Math.floor((position - offset - GUTTER_PX / 2) / (cell + GUTTER_PX));
  return Math.min(count - 1, Math.max(0, index));
}

export function cellAt(grid: CellGrid, x: number, y: number, frameCount: number): number | null {
  const col = axisCell(x, grid.offsetX, grid.cellW, grid.cols);
  const row = axisCell(y, grid.offsetY, grid.cellH, grid.rows);
  if (col === null || row === null) return null;
  const index = row * grid.cols + col;
  return index < frameCount ? index : null;
}

function listedTimes(call: string): number[] {
  const parts = LISTED_CALL.exec(call)?.[2]?.split(",") ?? [];
  return parts.flatMap((part) => findTimestamps(`[${part.trim()}]`).map((match) => match.seconds));
}

// Only frames calls name their times, in rounded labels; other sheets sample evenly between ends.
export function sheetCellTimes(source: SheetSource): number[] {
  const { startSeconds, endSeconds, frameCount } = source;
  if (source.cellTimes?.length === frameCount) return source.cellTimes;
  if (frameCount <= 1) return [startSeconds];
  const listed = listedTimes(source.call);
  if (listed.length === frameCount) return [startSeconds, ...listed.slice(1, -1), endSeconds];
  const step = (endSeconds - startSeconds) / (frameCount - 1);
  return Array.from({ length: frameCount }, (_, index) => startSeconds + index * step);
}
