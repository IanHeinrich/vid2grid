import { Vid2GridError } from "../errors";
import type {
  PlannedSheet,
  PlannedWatermark,
  RenderPlan,
  RenderPlanStyle,
} from "../plan/renderPlan";

export interface FillRectOp {
  kind: "fillRect";
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
}

export interface ImageOp {
  kind: "image";
  cellIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

// cellIndex lets a painter skip the text of a cell whose frame was never captured.
export interface TextOp {
  kind: "text";
  cellIndex: number;
  text: string;
  x: number;
  y: number;
  anchor: PlannedWatermark["anchor"];
  baseline: RenderPlanStyle["textBaseline"];
  fontSizePx: number;
  fontFamily: string;
  fill: string;
  stroke: string;
  strokeWidthPx: number;
}

export type DrawOp = FillRectOp | ImageOp | TextOp;

export function sheetDrawOps(plan: RenderPlan, sheetIndex: number): DrawOp[] {
  const sheet = plan.sheets[sheetIndex];
  if (sheet === undefined) {
    throw new Vid2GridError(
      "invalid_request",
      `sheetIndex ${sheetIndex} is not one of this plan's ${plan.sheets.length} sheets`,
    );
  }
  return plannedSheetDrawOps(plan, sheet);
}

export function plannedSheetDrawOps(plan: RenderPlan, sheet: PlannedSheet): DrawOp[] {
  const { style } = plan;
  const ops: DrawOp[] = [
    {
      kind: "fillRect",
      x: 0,
      y: 0,
      width: plan.canvas.width,
      height: plan.canvas.height,
      color: style.background,
    },
  ];
  sheet.cells.forEach((cell, cellIndex) => {
    ops.push({
      kind: "image",
      cellIndex,
      x: cell.x,
      y: cell.y,
      width: cell.width,
      height: cell.height,
    });
    for (const watermark of cell.watermarks) {
      ops.push({
        kind: "text",
        cellIndex,
        text: watermark.text,
        x: watermark.x,
        y: watermark.y,
        anchor: watermark.anchor,
        baseline: style.textBaseline,
        fontSizePx: watermark.fontSizePx,
        fontFamily: style.fontFamily,
        fill: style.textFill,
        stroke: style.textStroke,
        strokeWidthPx: watermark.strokeWidthPx,
      });
    }
  });
  return ops;
}
