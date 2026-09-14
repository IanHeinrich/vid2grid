import { computeOptimalGrid, GUTTER_PX } from "../grid/gridMaths";
import { combinedTranscriptFileName, gridFileName } from "../grid/gridFileName";
import {
  chooseTimestampFormat,
  formatTimestamp,
  FONT_HEIGHT_DIVISOR,
  MIN_FONT_SIZE,
  type TimestampFormat,
} from "../render/timestampFormat";
import { roundToMicroseconds, planFrameTimestamps } from "./framePlanning";
import { computeSheetWindows } from "./sheetWindows";
import {
  RENDER_PLAN_VERSION,
  type PlannedCell,
  type PlannedFrame,
  type PlannedSheet,
  type PlannedWatermark,
  type RenderPlan,
  type RenderPlanStyle,
} from "./renderPlan";
import { validateCollagePlanRequest, type CollagePlanRequest, type VideoInfo } from "../types";

const WATERMARK_INSET_PX = 4;

const STYLE: RenderPlanStyle = {
  background: "black",
  textFill: "black",
  textStroke: "white",
  fontFamily: "sans-serif",
  textBaseline: "top",
};

export function buildRenderPlan(request: CollagePlanRequest, info: VideoInfo): RenderPlan {
  validateCollagePlanRequest(request);

  const layout = computeOptimalGrid(
    request.framesPerGrid,
    info.width / info.height,
    request.outputResolution,
    GUTTER_PX,
  );
  const frames = planFrameTimestamps(request, info);
  const timestampFormat = chooseTimestampFormat(
    frames[frames.length - 1]?.timestampSeconds,
    request.targetFps,
  );

  const fontSizePx = Math.max(MIN_FONT_SIZE, Math.floor(layout.cellH / FONT_HEIGHT_DIVISOR));
  const strokeWidthPx = Math.max(1, Math.floor(fontSizePx / 8));

  const sheets: PlannedSheet[] = [];
  for (let first = 0; first < frames.length; first += request.framesPerGrid) {
    const sheetIndex = sheets.length;
    sheets.push({
      sheetIndex,
      fileName: gridFileName(sheetIndex),
      cells: frames
        .slice(first, first + request.framesPerGrid)
        .map((frame, cellIndex) =>
          planCell(frame, cellIndex, layout, timestampFormat, fontSizePx, strokeWidthPx),
        ),
    });
  }

  if (request.transcript?.scope === "per-sheet") {
    const windows = computeSheetWindows(
      sheets.map((sheet) => ({ timestamps: sheet.cells.map((cell) => cell.timestampSeconds) })),
      request.startSeconds,
      request.endSeconds,
    );
    windows.forEach((window, i) => {
      sheets[i].transcript = window;
    });
  }

  return {
    version: RENDER_PLAN_VERSION,
    canvas: { width: request.outputResolution, height: request.outputResolution },
    cell: { width: layout.cellW, height: layout.cellH },
    layout: {
      cols: layout.cols,
      rows: layout.rows,
      offsetX: layout.offsetX,
      offsetY: layout.offsetY,
    },
    style: STYLE,
    jpegQuality: request.jpegQuality,
    timestampFormat,
    frames,
    sheets,
    ...(request.transcript?.scope === "combined"
      ? {
          combinedTranscript: {
            startSeconds: roundToMicroseconds(request.startSeconds),
            endSeconds: roundToMicroseconds(request.endSeconds),
            fileName: combinedTranscriptFileName(),
          },
        }
      : {}),
  };
}

function planCell(
  frame: PlannedFrame,
  cellIndex: number,
  layout: { cols: number; cellW: number; cellH: number; offsetX: number; offsetY: number },
  timestampFormat: TimestampFormat,
  fontSizePx: number,
  strokeWidthPx: number,
): PlannedCell {
  const col = cellIndex % layout.cols;
  const row = Math.floor(cellIndex / layout.cols);
  const x = layout.offsetX + GUTTER_PX + col * (layout.cellW + GUTTER_PX);
  const y = layout.offsetY + GUTTER_PX + row * (layout.cellH + GUTTER_PX);

  const watermark = (
    text: string,
    anchor: PlannedWatermark["anchor"],
    watermarkX: number,
  ): PlannedWatermark => ({
    text,
    anchor,
    x: watermarkX,
    y: y + WATERMARK_INSET_PX,
    fontSizePx,
    strokeWidthPx,
  });

  return {
    frameIndex: frame.frameIndex,
    timestampSeconds: frame.timestampSeconds,
    x,
    y,
    width: layout.cellW,
    height: layout.cellH,
    watermarks: [
      watermark(
        formatTimestamp(frame.timestampSeconds, timestampFormat),
        "top-left",
        x + WATERMARK_INSET_PX,
      ),
      watermark(String(frame.frameIndex), "top-right", x + layout.cellW - WATERMARK_INSET_PX),
    ],
  };
}
