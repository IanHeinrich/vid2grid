import type { PlannedSheet, RenderPlan } from "../plan/renderPlan";
import type { TranscriptCue } from "../transcript/vtt";
import type { VideoInfo } from "../types";

export type ProgressCallback = (done: number, total: number) => void;

// Reading keyframe times means demuxing the whole file, so it is asked for only
// when keyframe mode needs them rather than on every probe.
export interface ProbeOptions {
  keyframeTimestamps: boolean;
}

export interface ProbePort<TSource> {
  probe(source: TSource, options: ProbeOptions): Promise<VideoInfo>;
}

export interface FrameCapturePort<TSource, TImage> {
  /** One image per `plan.frames` entry, in order, scaled to `plan.cell`. Fewer only when the stream ends early. */
  capture(source: TSource, plan: RenderPlan, onProgress?: ProgressCallback): Promise<TImage[]>;
}

/** `images` is aligned to `sheet.cells`; an entry is undefined when that frame was never captured. */
export interface SheetRenderJob<TImage> {
  sheet: PlannedSheet;
  images: (TImage | undefined)[];
}

export interface SheetEncoderPort<TImage, TBinary> {
  encodeSheets(
    plan: RenderPlan,
    jobs: SheetRenderJob<TImage>[],
    onProgress?: ProgressCallback,
  ): Promise<TBinary[]>;
}

// Separate stages because "model" (the one-time weights download) reports a
// byte-accurate percentage while "transcribe" only has an approximate heartbeat.
export type TranscribeStage = "model" | "transcribe";

export interface TranscriptPort<TSource> {
  transcribe(
    source: TSource,
    startSeconds: number,
    endSeconds: number,
    onProgress?: (stage: TranscribeStage, percent: number) => void,
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
  clock?: ClockPort;
}
