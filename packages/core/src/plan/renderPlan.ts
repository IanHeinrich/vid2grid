// The language-neutral contract between core, which decides everything here, and an executor,
// which only decodes, scales, pastes, draws text and encodes. docs/render-plan.md is the spec.
export const RENDER_PLAN_VERSION = 1;

export interface PlannedFrame {
  frameIndex: number;
  timestampSeconds: number;
}

export interface TimestampFormat {
  showHours: boolean;
  showMinutes: boolean;
  showMilliseconds: boolean;
}

export interface PlannedGridLayout {
  cols: number;
  rows: number;
  offsetX: number;
  offsetY: number;
}

export interface PlannedWatermark {
  text: string;
  anchor: "top-left" | "top-right";
  // Left edge for "top-left", right edge for "top-right": core has no font metrics,
  // so the executor measures the text itself (canvas measureText, Pillow anchor="ra").
  x: number;
  y: number;
  fontSizePx: number;
  // Canvas lineWidth is twice this; Pillow's stroke_width is exactly this.
  strokeWidthPx: number;
}

export interface PlannedCell {
  frameIndex: number;
  timestampSeconds: number;
  x: number;
  y: number;
  width: number;
  height: number;
  watermarks: PlannedWatermark[];
}

export interface TranscriptWindow {
  startSeconds: number;
  endSeconds: number;
  fileName: string;
}

export interface PlannedSheet {
  sheetIndex: number;
  fileName: string;
  cells: PlannedCell[];
  transcript?: TranscriptWindow;
}

export interface RenderPlanStyle {
  background: "black";
  textFill: "black";
  textStroke: "white";
  fontFamily: "sans-serif";
  textBaseline: "top";
}

export interface RenderPlan {
  version: typeof RENDER_PLAN_VERSION;
  canvas: { width: number; height: number };
  cell: { width: number; height: number };
  layout: PlannedGridLayout;
  style: RenderPlanStyle;
  jpegQuality: number;
  timestampFormat: TimestampFormat;
  frames: PlannedFrame[];
  sheets: PlannedSheet[];
  combinedTranscript?: TranscriptWindow;
}
