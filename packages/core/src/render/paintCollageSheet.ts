import type { CollageSheetInput } from "./sheetInput";
import type { SheetContext2D } from "./sheetContext";
import {
  formatTimestamp,
  FONT_HEIGHT_DIVISOR,
  MIN_FONT_SIZE,
  type TimestampFormat,
} from "./timestampFormat";

/**
 * Paints a whole collage sheet onto an already-created 2D context, working with
 * both a main-thread `HTMLCanvasElement` and a worker `OffscreenCanvas`.
 *
 * Each frame is drawn straight into its final cell position and watermarked in
 * place - no per-frame intermediate cell canvas - and cells past the supplied
 * frames stay the black background, which is what a trailing under-full sheet
 * wants.
 */
export function paintCollageSheet<TImage>(
  ctx: SheetContext2D<TImage>,
  input: CollageSheetInput<TImage>,
): void {
  const { layout, outputResolution, gutterPx } = input;

  ctx.fillStyle = "black";
  ctx.fillRect(0, 0, outputResolution, outputResolution);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  input.images.forEach((image, i) => {
    const row = Math.floor(i / layout.cols);
    const col = i % layout.cols;
    if (row >= layout.rows) return;
    const x = layout.offsetX + gutterPx + col * (layout.cellW + gutterPx);
    const y = layout.offsetY + gutterPx + row * (layout.cellH + gutterPx);
    ctx.drawImage(image, x, y, layout.cellW, layout.cellH);
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
function watermarkCell<TImage>(
  ctx: SheetContext2D<TImage>,
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

function drawStrokedText<TImage>(
  ctx: SheetContext2D<TImage>,
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
