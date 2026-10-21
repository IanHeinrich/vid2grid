import { cellOrigin, computeOptimalGrid, GUTTER_PX, type GridLayout } from "../grid/gridMaths";
import { combinedTranscriptFileName, gridFileName } from "./gridFileName";
import {
  chooseTimestampFormat,
  formatTimestamp,
  FONT_HEIGHT_DIVISOR,
  MIN_FONT_SIZE,
} from "./timestampFormat";
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
  type TimestampFormat,
  type TranscriptWindow,
} from "./renderPlan";
import { sourceAspect, type VideoInfo } from "../probe/videoInfo";
import { validateCollagePlanRequest, type CollagePlanRequest } from "./request";

const WATERMARK_INSET_PX = 4;
const STROKE_WIDTH_DIVISOR = 8;
const MIN_STROKE_WIDTH_PX = 1;

const STYLE: RenderPlanStyle = {
  background: "black",
  textFill: "black",
  textStroke: "white",
  fontFamily: "sans-serif",
  textBaseline: "top",
};

interface CellContext {
  layout: GridLayout;
  timestampFormat: TimestampFormat;
  fontSizePx: number;
  strokeWidthPx: number;
}

export function buildRenderPlan(request: CollagePlanRequest, info: VideoInfo): RenderPlan {
  validateCollagePlanRequest(request);
  return buildRenderPlanUnvalidated(request, info);
}

export function buildRenderPlanUnvalidated(
  request: CollagePlanRequest,
  info: VideoInfo,
): RenderPlan {
  const layout = computeOptimalGrid(request.framesPerGrid, {
    sourceAspect: sourceAspect(info),
    outputResolution: request.outputResolution,
    gutterPx: GUTTER_PX,
  });
  const frames = planFrameTimestamps(request, info);
  const timestampFormat = chooseTimestampFormat(
    frames[frames.length - 1]?.timestampSeconds,
    request.targetFps,
  );
  const fontSizePx = Math.max(MIN_FONT_SIZE, Math.floor(layout.cellH / FONT_HEIGHT_DIVISOR));
  const strokeWidthPx = Math.max(
    MIN_STROKE_WIDTH_PX,
    Math.floor(fontSizePx / STROKE_WIDTH_DIVISOR),
  );

  const sheets = planSheets(frames, request.framesPerGrid, {
    layout,
    timestampFormat,
    fontSizePx,
    strokeWidthPx,
  });
  if (request.transcript?.scope === "per-sheet") attachSheetWindows(sheets, request);

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
    ...(request.transcript?.scope === "combined" && {
      combinedTranscript: combinedTranscriptWindow(request),
    }),
  };
}

function planSheets(
  frames: PlannedFrame[],
  framesPerGrid: number,
  context: CellContext,
): PlannedSheet[] {
  const sheets: PlannedSheet[] = [];
  for (let first = 0; first < frames.length; first += framesPerGrid) {
    const sheetIndex = sheets.length;
    sheets.push({
      sheetIndex,
      fileName: gridFileName(sheetIndex),
      cells: frames
        .slice(first, first + framesPerGrid)
        .map((frame, cellIndex) => planCell(frame, cellIndex, context)),
    });
  }
  return sheets;
}

function attachSheetWindows(sheets: PlannedSheet[], request: CollagePlanRequest): void {
  const windows = computeSheetWindows(
    sheets.map((sheet) => ({ timestamps: sheet.cells.map((cell) => cell.timestampSeconds) })),
    request.startSeconds,
    request.endSeconds,
  );
  sheets.forEach((sheet, i) => {
    const window = windows[i];
    if (window) sheet.transcript = window;
  });
}

function combinedTranscriptWindow(request: CollagePlanRequest): TranscriptWindow {
  return {
    startSeconds: roundToMicroseconds(request.startSeconds),
    endSeconds: roundToMicroseconds(request.endSeconds),
    fileName: combinedTranscriptFileName(),
  };
}

function planCell(frame: PlannedFrame, cellIndex: number, context: CellContext): PlannedCell {
  const { layout, timestampFormat, fontSizePx, strokeWidthPx } = context;
  const { x, y } = cellOrigin(layout, cellIndex, GUTTER_PX);

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
