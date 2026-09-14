import type { PlannedSheet, RenderPlan } from "../plan/renderPlan";
import type { SheetContext2D } from "./sheetContext";

export function paintSheetFromPlan<TImage>(
  ctx: SheetContext2D<TImage>,
  plan: RenderPlan,
  sheet: PlannedSheet,
  images: readonly (TImage | undefined)[],
): void {
  ctx.fillStyle = plan.style.background;
  ctx.fillRect(0, 0, plan.canvas.width, plan.canvas.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.textBaseline = plan.style.textBaseline;
  ctx.lineJoin = "round";

  sheet.cells.forEach((cell, i) => {
    const image = images[i];
    if (image === undefined) return;
    ctx.drawImage(image, cell.x, cell.y, cell.width, cell.height);

    for (const watermark of cell.watermarks) {
      ctx.font = `${watermark.fontSizePx}px ${plan.style.fontFamily}`;
      const x =
        watermark.anchor === "top-right"
          ? watermark.x - ctx.measureText(watermark.text).width
          : watermark.x;
      ctx.lineWidth = watermark.strokeWidthPx * 2;
      ctx.strokeStyle = plan.style.textStroke;
      ctx.strokeText(watermark.text, x, watermark.y);
      ctx.fillStyle = plan.style.textFill;
      ctx.fillText(watermark.text, x, watermark.y);
    }
  });
}
