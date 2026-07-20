export interface GridLayout {
  cols: number;
  rows: number;
  cellW: number;
  cellH: number;
  offsetX: number;
  offsetY: number;
}

export function computeOptimalGrid(
  frameCount: number,
  sourceAspect: number,
  outputResolution: number,
  gutterPx: number,
): GridLayout {
  if (frameCount <= 0) throw new Error("frameCount must be positive");
  if (sourceAspect <= 0) throw new Error("sourceAspect must be positive");
  if (outputResolution <= 0) throw new Error("outputResolution must be positive");
  if (gutterPx < 0) throw new Error("gutterPx must not be negative");

  let best: GridLayout | null = null;
  let bestArea = -1;

  for (let cols = 1; cols <= frameCount; cols++) {
    const rows = Math.ceil(frameCount / cols);

    const availW = outputResolution - (cols + 1) * gutterPx;
    const availH = outputResolution - (rows + 1) * gutterPx;
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
      const gridW = cols * cellWInt + (cols + 1) * gutterPx;
      const gridH = rows * cellHInt + (rows + 1) * gutterPx;
      best = {
        cols,
        rows,
        cellW: cellWInt,
        cellH: cellHInt,
        offsetX: Math.floor((outputResolution - gridW) / 2),
        offsetY: Math.floor((outputResolution - gridH) / 2),
      };
    }
  }

  if (best === null) {
    throw new Error(
      "output_resolution too small to fit frame_count frames with the given gutter",
    );
  }
  return best;
}
