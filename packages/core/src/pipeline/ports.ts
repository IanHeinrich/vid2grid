import type { CollageRequest, VideoInfo } from "../types";
import type { CollageSheetInput } from "../render/sheetInput";
import type { TranscriptCue } from "../transcript/vtt";

export interface ProbePort<TSource> {
  probe(source: TSource): Promise<VideoInfo>;
}

export interface CapturedFrame<TImage> {
  timestamp: number;
  frameIndex: number;
  image: TImage;
}

export interface FrameCapturePort<TSource, TImage> {
  /** Frames in ascending time order, already scaled to `cell`. Keyframe mode picks its own timestamps. */
  capture(
    source: TSource,
    request: CollageRequest,
    cell: { width: number; height: number },
    keyframeSampling: boolean,
    onProgress?: (done: number, total: number) => void,
  ): Promise<CapturedFrame<TImage>[]>;
}

export interface SheetEncoderPort<TImage, TBinary> {
  encodeSheets(
    sheets: CollageSheetInput<TImage>[],
    jpegQuality: number,
    onProgress?: (done: number, total: number) => void,
  ): Promise<TBinary[]>;
}

/**
 * "model" covers the one-time (host-cached) download of a speech model's
 * weights; "transcribe" covers actually running it on the audio. Reported
 * separately so a UI can show a distinct, honest label for each - the model
 * stage has a real byte-accurate percentage, the transcribe stage only an
 * approximate "still working" heartbeat.
 */
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
