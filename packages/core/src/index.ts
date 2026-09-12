export { validateCollageRequest, type CollageRequest, type VideoInfo } from "./types";

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
  formatTimestamp,
  FONT_HEIGHT_DIVISOR,
  MIN_FONT_SIZE,
  type TimestampFormat,
} from "./render/timestampFormat";
export type { CollageSheetInput } from "./render/sheetInput";
export type { SheetContext2D } from "./render/sheetContext";
export { paintCollageSheet } from "./render/paintCollageSheet";

export {
  cuesInWindow,
  cuesToVtt,
  formatVttTimestamp,
  vttToPlainText,
  type TranscriptCue,
} from "./transcript/vtt";

export { computeSheetWindows } from "./plan/sheetWindows";

export type {
  CapturedFrame,
  ClockPort,
  CollagePorts,
  FrameCapturePort,
  ProbePort,
  SheetEncoderPort,
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
  type TranscriptOptions,
} from "./pipeline/generateCollages";
