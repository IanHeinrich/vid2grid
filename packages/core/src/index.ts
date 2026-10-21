export { Vid2GridError, type Vid2GridErrorCode } from "./errors";
export { clamp, roundToTenth } from "./math";

export {
  collagePlanRequestProblem,
  validateCollagePlanRequest,
  type CollagePlanRequest,
  type SamplingRange,
} from "./plan/request";
export { sourceAspect, type VideoInfo } from "./probe/videoInfo";
export { rotationFromMatrix } from "./probe/rotation";
export {
  displaySize,
  isQuarterTurn,
  normalizeRotationClockwise,
  type SampleAspectRatio,
} from "./probe/displaySize";

export { GUTTER_PX, type GridParams } from "./grid/gridMaths";
export {
  countGridPackingBlanks,
  estimateExtractedFrameCount,
  estimateSheetCount,
  isKeyframeDense,
  keyframesPerSecond,
  suggestFramesPerGrid,
  type FrameCountEstimateInput,
  type FramesPerGridSuggestion,
  type SuggestFramesPerGridInput,
} from "./plan/frameSuggestions";
export { CUSTOM_OPTION, MODEL_RESOLUTION_PRESETS } from "./grid/modelProfiles";

export type { SheetContext2D } from "./render/sheetContext";
export { paintSheetFromPlan } from "./render/paintSheetFromPlan";
export {
  sheetDrawOps,
  type DrawOp,
  type FillRectOp,
  type ImageOp,
  type TextOp,
} from "./render/drawOps";

export { vttToPlainText, type TranscriptCue } from "./transcript/vtt";
export { cuesFromSegments, type TranscriptSegment } from "./transcript/segments";
export {
  NO_TRANSCRIPTION_PORT,
  transcriptFiles,
  transcriptionFailedWarning,
  type TranscriptFile,
} from "./transcript/transcriptFiles";

export { buildRenderPlan } from "./plan/buildRenderPlan";
export {
  OPTION_SPECS,
  optionSpecsFor,
  requestFromOptions,
  type BooleanOptionSpec,
  type EnumOptionSpec,
  type HostCapability,
  type NumberOptionSpec,
  type OptionName,
  type OptionSpec,
  type PlanOptionInput,
  type PlanOptionValues,
  type TranscriptOption,
} from "./plan/options";
export { resolveKeyframeSampling, type KeyframeSamplingDecision } from "./plan/keyframeFallback";
export { createFrameMatcher, isKeyframePlan, type FrameMatcher } from "./plan/frameMatching";
export {
  keyframesInRange,
  MICROSECONDS_PER_SECOND,
  roundToMicroseconds,
  secondsToMicroseconds,
} from "./plan/framePlanning";
export { buildGridsFolderName, formatClock } from "./presentation";
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
  Phase,
  PortProgress,
  PortProgressCallback,
  ProbePort,
  Progress,
  ProgressCallback,
  SheetEncoderPort,
  SheetRenderJob,
  TextPort,
  TranscribeStage,
  TranscriptPort,
} from "./pipeline/ports";
export {
  generateCollages,
  streamCollages,
  type GeneratedFile,
  type GenerateCollagesOptions,
  type GenerateCollagesResult,
  type GenerationTimings,
  type PhaseTimings,
  type StreamCollagesOptions,
  type StreamCollagesResult,
  type Vid2GridWarning,
  type WarningCode,
} from "./pipeline/generateCollages";
