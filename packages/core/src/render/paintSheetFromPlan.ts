import type { PlannedSheet, RenderPlan } from "../plan/renderPlan";
import { plannedSheetDrawOps, type TextOp } from "./drawOps";
import type { SheetContext2D } from "./sheetContext";

export function paintSheetFromPlan<TImage>(
  ctx: SheetContext2D<TImage>,
  plan: RenderPlan,
  sheet: PlannedSheet,
  images: readonly (TImage | undefined)[],
): void {
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.lineJoin = "round";
  for (const op of plannedSheetDrawOps(plan, sheet)) {
    switch (op.kind) {
      case "fillRect":
        ctx.fillStyle = op.color;
        ctx.fillRect(op.x, op.y, op.width, op.height);
        break;
      case "image": {
        const image = images[op.cellIndex];
        if (image !== undefined) ctx.drawImage(image, op.x, op.y, op.width, op.height);
        break;
      }
      case "text":
        if (images[op.cellIndex] !== undefined) paintText(ctx, op);
        break;
    }
  }
}

function paintText<TImage>(ctx: SheetContext2D<TImage>, op: TextOp): void {
  ctx.font = `${op.fontSizePx}px ${op.fontFamily}`;
  ctx.textBaseline = op.baseline;
  const x = op.anchor === "top-right" ? op.x - ctx.measureText(op.text).width : op.x;
  ctx.lineWidth = op.strokeWidthPx * 2;
  ctx.strokeStyle = op.stroke;
  ctx.strokeText(op.text, x, op.y);
  ctx.fillStyle = op.fill;
  ctx.fillText(op.text, x, op.y);
}
