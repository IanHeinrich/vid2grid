export { validateCollagePlanRequest, type CollagePlanRequest, type VideoInfo } from "./types";

export { computeOptimalGrid, GUTTER_PX, type GridLayout } from "./grid/gridMaths";
export {
  countBlankCells,
  countGridPackingBlanks,
  estimateExtractedFrameCount,
  estimateSheetCount,
  suggestFramesPerGrid,
  type FramesPerGridSuggestion,
} from "./grid/frameSuggestions";
export {
  combinedTranscriptFileName,
  gridFileName,
  gridTranscriptFileName,
} from "./grid/gridFileName";
export { CUSTOM_OPTION, MODEL_RESOLUTION_PRESETS } from "./grid/modelProfiles";

export {
  chooseTimestampFormat,
  formatTimestamp,
  FONT_HEIGHT_DIVISOR,
  MIN_FONT_SIZE,
  type TimestampFormat,
} from "./render/timestampFormat";
export type { SheetContext2D } from "./render/sheetContext";
export { paintSheetFromPlan } from "./render/paintSheetFromPlan";

export {
  cuesInWindow,
  cuesToVtt,
  formatVttTimestamp,
  vttToPlainText,
  type TranscriptCue,
} from "./transcript/vtt";

export { buildRenderPlan } from "./plan/buildRenderPlan";
export { planFrameTimestamps, roundToMicroseconds, subsampleEvenly } from "./plan/framePlanning";
export { computeSheetWindows } from "./plan/sheetWindows";
export {
  RENDER_PLAN_VERSION,
  type PlannedCell,
  type PlannedFrame,
  type PlannedGridLayout,
  type PlannedSheet,
  type PlannedWatermark,
  type RenderPlan,
  type RenderPlanStyle,
  type TranscriptWindow,
} from "./plan/renderPlan";

export type {
  ClockPort,
  CollagePorts,
  FrameCapturePort,
  ProbePort,
  ProgressCallback,
  SheetEncoderPort,
  SheetRenderJob,
  TextPort,
  TranscribeStage,
  TranscriptPort,
} from "./pipeline/ports";
export {
  generateCollages,
  type GeneratedFile,
  type GenerateCollagesOptions,
  type GenerateCollagesResult,
  type GenerationPhase,
  type GenerationTimings,
} from "./pipeline/generateCollages";
