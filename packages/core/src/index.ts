export { validateCollagePlanRequest, type CollagePlanRequest, type VideoInfo } from "./types";

export { GUTTER_PX } from "./grid/gridMaths";
export {
  countGridPackingBlanks,
  estimateExtractedFrameCount,
  estimateSheetCount,
  suggestFramesPerGrid,
  type FramesPerGridSuggestion,
} from "./grid/frameSuggestions";
export { CUSTOM_OPTION, MODEL_RESOLUTION_PRESETS } from "./grid/modelProfiles";

export type { SheetContext2D } from "./render/sheetContext";
export { paintSheetFromPlan } from "./render/paintSheetFromPlan";

export { vttToPlainText, type TranscriptCue } from "./transcript/vtt";

export { buildRenderPlan } from "./plan/buildRenderPlan";
export { roundToMicroseconds } from "./plan/framePlanning";
export {
  RENDER_PLAN_VERSION,
  type PlannedCell,
  type PlannedFrame,
  type PlannedGridLayout,
  type PlannedSheet,
  type PlannedWatermark,
  type RenderPlan,
  type RenderPlanStyle,
  type TimestampFormat,
  type TranscriptWindow,
} from "./plan/renderPlan";

export type {
  ClockPort,
  CollagePorts,
  FrameCapturePort,
  ProbeOptions,
  ProbePort,
  ProgressCallback,
  SheetEncoderPort,
  SheetRenderJob,
  TextPort,
  TranscribeProgressCallback,
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
