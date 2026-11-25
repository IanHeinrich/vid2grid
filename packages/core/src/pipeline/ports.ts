import type { AbortSignalLike } from "../audio/audioAnalysis";
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
  // Yields one image per plan.frames entry, in plan order, scaled to plan.cell; it stops
  // early only when the stream ends. A host keeps only a small, bounded buffer ahead of
  // what the pipeline pulls, so memory stays at the sheets in flight, and the pipeline
  // counts progress itself. info is what the plan was built from, for isKeyframePlan.
  // Once signal aborts, the host stops decoding and the pending pull rejects; a host that
  // ignores it is stopped by its iterator's return() after the pull it is on.
  capture(
    source: TSource,
    plan: RenderPlan,
    info: VideoInfo,
    signal?: AbortSignalLike,
  ): AsyncIterable<TImage>;
  // Frees an image the pipeline pulled but will never encode (a failed or abandoned run).
  release?(image: TImage): void;
}

export interface SheetRenderJob<TImage> {
  sheet: PlannedSheet;
  // Aligned to sheet.cells; undefined where that frame was never captured. encode owns
  // these images from the moment it is called, and frees them whatever the outcome.
  images: (TImage | undefined)[];
}

export interface SheetEncoderPort<TImage, TBinary> {
  // A host may reject a job it has not begun once signal aborts.
  encode(plan: RenderPlan, job: SheetRenderJob<TImage>, signal?: AbortSignalLike): Promise<TBinary>;
  // How many sheets may encode at once (a worker pool's size); 1 when unset.
  concurrency?: number;
}

export interface TranscriptPort<TSource> {
  transcribe(
    source: TSource,
    startSeconds: number,
    endSeconds: number,
    onProgress?: PortProgressCallback,
    signal?: AbortSignalLike,
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
