import type { PlannedSheet, RenderPlan } from "../plan/renderPlan";
import type { TranscriptCue } from "../transcript/vtt";
import type { VideoInfo } from "../probe/videoInfo";

export type Phase = "extracting" | "rendering" | "transcribing";

// Separate stages because "model" (the one-time weights download) is byte-accurate
// while "transcribe" only has an approximate heartbeat.
export type TranscribeStage = "model" | "transcribe";

export interface Progress {
  phase: Phase;
  done: number;
  total: number;
  stage?: TranscribeStage;
}

export type ProgressCallback = (progress: Progress) => void;

// A port reports its own counts; the pipeline knows which phase it is in.
export type PortProgress = Omit<Progress, "phase">;
export type PortProgressCallback = (progress: PortProgress) => void;

export interface ProbePort<TSource> {
  probe(source: TSource): Promise<VideoInfo>;
  // Demuxes the whole file, so it is only asked for when keyframe mode needs it.
  readKeyframeTimes(source: TSource): Promise<number[] | undefined>;
}

export interface FrameCapturePort<TSource, TImage> {
  // One image per plan.frames entry, in order, scaled to plan.cell; fewer only when the
  // stream ends early. info is what the plan was built from, for isKeyframePlan.
  capture(
    source: TSource,
    plan: RenderPlan,
    info: VideoInfo,
    onProgress?: PortProgressCallback,
  ): Promise<TImage[]>;
}

export interface SheetRenderJob<TImage> {
  sheet: PlannedSheet;
  // Aligned to sheet.cells; undefined where that frame was never captured.
  images: (TImage | undefined)[];
}

export interface SheetEncoderPort<TImage, TBinary> {
  encode(
    plan: RenderPlan,
    jobs: SheetRenderJob<TImage>[],
    onProgress?: PortProgressCallback,
  ): Promise<TBinary[]>;
}

export interface TranscriptPort<TSource> {
  transcribe(
    source: TSource,
    startSeconds: number,
    endSeconds: number,
    onProgress?: PortProgressCallback,
  ): Promise<TranscriptCue[]>;
}

export interface TextPort<TBinary> {
  encodeText(text: string, mimeType: string): TBinary;
}

export interface ClockPort {
  now(): number;
}

export interface CollagePorts<TSource, TImage, TBinary> {
  probe: ProbePort<TSource>;
  frames: FrameCapturePort<TSource, TImage>;
  sheets: SheetEncoderPort<TImage, TBinary>;
  text: TextPort<TBinary>;
  transcript?: TranscriptPort<TSource>;
  clock: ClockPort;
}
