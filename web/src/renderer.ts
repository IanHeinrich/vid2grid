import type { GridLayout } from "./gridMaths";

export const GUTTER_PX = 8;
const FONT_HEIGHT_DIVISOR = 16; // font size = cell height / this; smaller cells get smaller text
const MIN_FONT_SIZE = 8;


export interface TimestampFormat {
  showHours: boolean;
  showMinutes: boolean;
  showMilliseconds: boolean;
}

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

type SheetContext2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/**
 * A single collage sheet's worth of frames plus the geometry needed to paint it.
 *
 * Transfer friendly (its `bitmaps` are Transferable) so the whole sheet can be
 * shipped to a render worker unchanged.
 */
export interface CollageSheetInput {
  bitmaps: ImageBitmap[];
  timestamps: number[];
  frameIndices: number[];
  layout: GridLayout;
  outputResolution: number;
  gutterPx: number;
  timestampFormat: TimestampFormat;
}

/**
 * Paints a whole collage sheet onto an already-created 2D context, working with
 * both a main-thread `HTMLCanvasElement` and a worker `OffscreenCanvas`.
 *
 * Each frame is drawn straight into its final cell position and watermarked in
 * place - no per-frame intermediate cell canvas - and cells past the supplied
 * frames stay the black background, which is what a trailing under-full sheet
 * wants.
 */
export function paintCollageSheet(ctx: SheetContext2D, input: CollageSheetInput): void {
  const { layout, outputResolution, gutterPx } = input;

  ctx.fillStyle = "black";
  ctx.fillRect(0, 0, outputResolution, outputResolution);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  input.bitmaps.forEach((bitmap, i) => {
    const row = Math.floor(i / layout.cols);
    const col = i % layout.cols;
    if (row >= layout.rows) return;
    const x = layout.offsetX + gutterPx + col * (layout.cellW + gutterPx);
    const y = layout.offsetY + gutterPx + row * (layout.cellH + gutterPx);
    ctx.drawImage(bitmap, x, y, layout.cellW, layout.cellH);
    watermarkCell(
      ctx,
      x,
      y,
      layout.cellW,
      layout.cellH,
      input.timestamps[i],
      input.frameIndices[i],
      input.timestampFormat,
    );
  });
}

/**
 * Draws a timestamp (top-left) and frame index (top-right) inside the cell at
 * (offsetX, offsetY): black text with a white stroke. Font scales with the
 * cell's final rendered height.
 *
 * `format` drops components (hours, minutes, milliseconds) that are redundant
 * for the whole batch this frame belongs to, e.g. a short clip sampled at 1fps
 * or slower gets a plain `SS` timestamp instead of `00:SS.000`.
 */
function watermarkCell(
  ctx: SheetContext2D,
  offsetX: number,
  offsetY: number,
  cellW: number,
  cellH: number,
  timestamp: number,
  frameIndex: number,
  format: TimestampFormat,
): void {
  const fontSize = Math.max(MIN_FONT_SIZE, Math.floor(cellH / FONT_HEIGHT_DIVISOR));
  const strokeWidth = Math.max(1, Math.floor(fontSize / 8));

  ctx.font = `${fontSize}px sans-serif`;
  ctx.textBaseline = "top";
  ctx.lineJoin = "round";

  const timestampText = formatTimestamp(timestamp, format);
  const indexText = String(frameIndex);

  drawStrokedText(ctx, timestampText, offsetX + 4, offsetY + 4, strokeWidth);

  const indexWidth = ctx.measureText(indexText).width;
  drawStrokedText(ctx, indexText, offsetX + cellW - indexWidth - 4, offsetY + 4, strokeWidth);
}

function drawStrokedText(
  ctx: SheetContext2D,
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
