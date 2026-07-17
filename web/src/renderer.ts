import type { GridLayout } from "./gridMaths";

export const GUTTER_PX = 8;
const FONT_HEIGHT_DIVISOR = 16; // font size = cell height / this; smaller cells get smaller text
const MIN_FONT_SIZE = 8;


export interface TimestampFormat {
  showHours: boolean;
  showMinutes: boolean;
  showMilliseconds: boolean;
}

const DEFAULT_TIMESTAMP_FORMAT: TimestampFormat = {
  showHours: false,
  showMinutes: true,
  showMilliseconds: false,
};

function formatTimestamp(seconds: number, format: TimestampFormat): string {
  const totalMs = Math.round(seconds * 1000);
  const hours = Math.floor(totalMs / 3_600_000);
  const afterHoursMs = totalMs % 3_600_000;
  const minutes = Math.floor(afterHoursMs / 60_000);
  const afterMinutesMs = afterHoursMs % 60_000;
  const secs = Math.floor(afterMinutesMs / 1000);
  const ms = afterMinutesMs % 1000;

  const secondsText = format.showMilliseconds
    ? `${String(secs).padStart(2, "0")}.${String(ms).padStart(3, "0")}`
    : String(secs).padStart(2, "0");

  if (format.showHours) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${secondsText}`;
  }
  if (format.showMinutes) {
    return `${String(minutes).padStart(2, "0")}:${secondsText}`;
  }
  return secondsText;
}

export function resizeToCell(
  bitmap: ImageBitmap,
  cellW: number,
  cellH: number,
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = cellW;
  canvas.height = cellH;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, cellW, cellH);
  return canvas;
}

/**
 * Draws a timestamp (top-left) and frame index (top-right): black text, white stroke.
 *
 * Expects `cell` to already be resized to its final collage cell size, so the
 * font scales with the frame's actual rendered resolution rather than its
 * original capture resolution.
 *
 * `format` drops components (hours, minutes, milliseconds) that are redundant
 * for the whole batch this frame belongs to, e.g. a short clip sampled at 1fps
 * or slower gets a plain `SS` timestamp instead of `00:SS.000`.
 */
export function watermarkFrame(
  cell: HTMLCanvasElement,
  timestamp: number,
  frameIndex: number,
  format: TimestampFormat = DEFAULT_TIMESTAMP_FORMAT,
): HTMLCanvasElement {
  const ctx = cell.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");

  const fontSize = Math.max(MIN_FONT_SIZE, Math.floor(cell.height / FONT_HEIGHT_DIVISOR));
  const strokeWidth = Math.max(1, Math.floor(fontSize / 8));

  ctx.font = `${fontSize}px sans-serif`;
  ctx.textBaseline = "top";
  ctx.lineJoin = "round";

  const timestampText = formatTimestamp(timestamp, format);
  const indexText = String(frameIndex);

  drawStrokedText(ctx, timestampText, 4, 4, strokeWidth);

  const indexWidth = ctx.measureText(indexText).width;
  drawStrokedText(ctx, indexText, cell.width - indexWidth - 4, 4, strokeWidth);

  return cell;
}

function drawStrokedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  strokeWidth: number,
): void {
  ctx.strokeStyle = "white";
  ctx.lineWidth = strokeWidth * 2;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = "black";
  ctx.fillText(text, x, y);
}

/**
 * Pastes already cell-sized frames onto a black outputResolution x outputResolution canvas.
 *
 * Cells beyond cells.length (i.e. a trailing, under-full collage) are left
 * untouched, which is pure black since the canvas is black-initialized.
 */
export function assembleCollage(
  cells: HTMLCanvasElement[],
  layout: GridLayout,
  outputResolution: number,
  gutterPx: number = GUTTER_PX,
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = outputResolution;
  canvas.height = outputResolution;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  ctx.fillStyle = "black";
  ctx.fillRect(0, 0, outputResolution, outputResolution);

  cells.forEach((cell, i) => {
    const row = Math.floor(i / layout.cols);
    const col = i % layout.cols;
    if (row >= layout.rows) return;
    const x = layout.offsetX + gutterPx + col * (layout.cellW + gutterPx);
    const y = layout.offsetY + gutterPx + row * (layout.cellH + gutterPx);
    ctx.drawImage(cell, x, y);
  });

  return canvas;
}

/** Encodes a collage canvas as a JPEG Blob at the given quality (1-100). */
export function canvasToJpegBlob(canvas: HTMLCanvasElement, quality = 80): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Failed to encode JPEG"));
      },
      "image/jpeg",
      quality / 100,
    );
  });
}
