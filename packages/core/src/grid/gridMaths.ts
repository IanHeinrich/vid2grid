import { Vid2GridError } from "../errors";

export const GUTTER_PX = 8;

export interface GridParams {
  sourceAspect: number;
  outputResolution: number;
  gutterPx: number;
}

export interface GridLayout {
  cols: number;
  rows: number;
  cellW: number;
  cellH: number;
  offsetX: number;
  offsetY: number;
}

// Every cell has a gutter before it and the last has one after it too.
function spanWithGutters(count: number, cellSize: number, gutterPx: number): number {
  return count * cellSize + (count + 1) * gutterPx;
}

export function cellOrigin(
  layout: GridLayout,
  cellIndex: number,
  gutterPx: number,
): { x: number; y: number } {
  const col = cellIndex % layout.cols;
  const row = Math.floor(cellIndex / layout.cols);
  return {
    x: layout.offsetX + spanWithGutters(col, layout.cellW, gutterPx),
    y: layout.offsetY + spanWithGutters(row, layout.cellH, gutterPx),
  };
}

function assertGridInputs(frameCount: number, grid: GridParams): void {
  const invalid = (message: string) => new Vid2GridError("invalid_request", message);
  if (frameCount <= 0) throw invalid("frameCount must be positive");
  if (grid.sourceAspect <= 0) throw invalid("sourceAspect must be positive");
  if (grid.outputResolution <= 0) throw invalid("outputResolution must be positive");
  if (grid.gutterPx < 0) throw invalid("gutterPx must not be negative");
}

export function computeOptimalGrid(frameCount: number, grid: GridParams): GridLayout {
  assertGridInputs(frameCount, grid);
  const { sourceAspect, outputResolution, gutterPx } = grid;

  let best: GridLayout | null = null;
  let bestArea = -1;

  for (let cols = 1; cols <= frameCount; cols++) {
    const rows = Math.ceil(frameCount / cols);

    const availW = outputResolution - spanWithGutters(cols, 0, gutterPx);
    const availH = outputResolution - spanWithGutters(rows, 0, gutterPx);
    if (availW <= 0 || availH <= 0) continue;

    const cellWByWidth = availW / cols;
    const cellHByHeight = availH / rows;

    const candidateH = cellWByWidth / sourceAspect;
    let cellW: number;
    let cellH: number;
    if (candidateH <= cellHByHeight) {
      cellW = cellWByWidth;
      cellH = candidateH;
    } else {
      cellH = cellHByHeight;
      cellW = cellH * sourceAspect;
    }

    const area = cellW * cellH;
    if (area > bestArea) {
      bestArea = area;
      const cellWInt = Math.trunc(cellW);
      const cellHInt = Math.trunc(cellH);
      best = {
        cols,
        rows,
        cellW: cellWInt,
        cellH: cellHInt,
        offsetX: Math.floor((outputResolution - spanWithGutters(cols, cellWInt, gutterPx)) / 2),
        offsetY: Math.floor((outputResolution - spanWithGutters(rows, cellHInt, gutterPx)) / 2),
      };
    }
  }

  if (best === null) {
    throw new Vid2GridError(
      "invalid_request",
      "output_resolution too small to fit frame_count frames with the given gutter",
    );
  }
  return best;
}
