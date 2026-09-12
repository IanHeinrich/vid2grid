import type { PlannedSheet, RenderPlan } from "../plan/renderPlan";
import type { TranscriptCue } from "../transcript/vtt";
import type { VideoInfo } from "../types";

export type ProgressCallback = (done: number, total: number) => void;

export interface ProbePort<TSource> {
  probe(source: TSource): Promise<VideoInfo>;
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

// "model" is the one-time (host-cached) weights download, "transcribe" is
// running the model: the first has a byte-accurate percentage, the second only
// an approximate heartbeat, so a UI can label them honestly.
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
