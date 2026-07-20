import type { CollageRequest } from "./types";
import { getVideoMetadata, type ExtractedFrame, type ExtractionProgress } from "./extractor";
import { extractFramesAuto } from "./frameExtraction";
import { computeOptimalGrid, type GridLayout } from "./gridMaths";
import { GUTTER_PX, type CollageSheetInput, type TimestampFormat } from "./renderer";
import { renderSheetsToBlobs } from "./sheetRenderer";
import { decodeAudioForTranscription } from "./audioExtraction";
import { transcribeAudio, cuesToVtt, type TranscriptCue, type TranscribeStage } from "./transcription";
import { gridTranscriptFileName, combinedTranscriptFileName } from "./gridFileName";

export type GenerationPhase = "extracting" | "rendering" | "transcribing";

/** Lightweight per-phase timing, surfaced via `onTiming` for profiling. */
export interface GenerationTimings {
  extractMs: number;
  renderMs: number;
  transcribeMs?: number;
  frameCount: number;
  sheetCount: number;
}

export interface TranscriptFile {
  name: string;
  blob: Blob;
}

export interface TranscriptOptions {
  /**
   * "per-sheet" pairs one .vtt with each grid sheet's frame time window;
   * "combined" produces a single whole-export transcript.vtt instead.
   */
  scope: "per-sheet" | "combined";
}

export interface GenerateCollagesResult {
  sheets: Blob[];
  transcriptFiles: TranscriptFile[];
}

export interface GenerateCollagesOptions {
  /**
   * `transcribeStage` is only ever populated during the "transcribing"
   * phase, distinguishing the one-time (browser-cached) model download from
   * actually running it on the audio - callers can use it to show a more
   * honest label than a single generic "transcribing" message.
   */
  onProgress?: (phase: GenerationPhase, done: number, total: number, transcribeStage?: TranscribeStage) => void;
  onTiming?: (timings: GenerationTimings) => void;
  /**
   * Non-fatal problems (e.g. transcription failed or the video has no audio
   * track) are reported here rather than thrown, so a transcript failure
   * never loses the already-rendered grid images.
   */
  onWarning?: (message: string) => void;
  /**
   * Source pixel aspect ratio (width / height), when the caller already knows it
   * from reading the video's metadata - avoids re-reading it here just to lay out
   * the grid. Ignored when a stub extractor is injected.
   */
  sourceAspect?: number;
  /**
   * Opt-in fast mode: decode only the keyframe nearest each sampled timestamp
   * (WebCodecs path only), trading exact-time frames for far less decode work.
   */
  keyframeSampling?: boolean;
  /** Opt-in: also generate an in-browser speech-to-text transcript. */
  transcript?: TranscriptOptions;
  /** Injectable for tests - defaults to the real <video>/<canvas> based extractor. */
  extractFramesImpl?: (
    config: CollageRequest,
    onProgress?: ExtractionProgress,
    layout?: GridLayout,
    keyframeSampling?: boolean,
  ) => Promise<ExtractedFrame[]>;
  /** Injectable for tests - defaults to the real audio-decode + Whisper pipeline. */
  transcribeImpl?: (
    config: CollageRequest,
    onProgress?: (stage: TranscribeStage, percent: number) => void,
  ) => Promise<TranscriptCue[]>;
}

async function defaultTranscribeImpl(
  config: CollageRequest,
  onProgress?: (stage: TranscribeStage, percent: number) => void,
): Promise<TranscriptCue[]> {
  const samples = await decodeAudioForTranscription(config.videoFile, config.startTime, config.endTime);
  return transcribeAudio(samples, config.startTime, onProgress);
}

/** A cue belongs to a sheet's window if it overlaps `[windowStart, windowEnd)` at all. */
function cuesInWindow(cues: TranscriptCue[], windowStart: number, windowEnd: number): TranscriptCue[] {
  return cues.filter((cue) => cue.start < windowEnd && cue.end > windowStart);
}

/**
 * One time window per sheet, splitting the gaps between sheets at their
 * midpoint so every cue in `[config.startTime, config.endTime]` lands in
 * exactly one sheet's transcript.
 */
function computeSheetWindows(sheets: CollageSheetInput[], config: CollageRequest): [number, number][] {
  const firsts = sheets.map((s) => s.timestamps[0]);
  const lasts = sheets.map((s) => s.timestamps[s.timestamps.length - 1]);
  return sheets.map((_, i) => {
    const start = i === 0 ? config.startTime : (lasts[i - 1] + firsts[i]) / 2;
    const end = i === sheets.length - 1 ? config.endTime : (lasts[i] + firsts[i + 1]) / 2;
    return [start, end];
  });
}

async function generateTranscriptFiles(
  config: CollageRequest,
  sheets: CollageSheetInput[],
  transcript: TranscriptOptions,
  transcribeImpl: (
    config: CollageRequest,
    onProgress?: (stage: TranscribeStage, percent: number) => void,
  ) => Promise<TranscriptCue[]>,
  onProgress?: (done: number, total: number, stage: TranscribeStage) => void,
  onTranscribeMs?: (ms: number) => void,
): Promise<TranscriptFile[]> {
  const transcribeStart = performance.now();
  const cues = await transcribeImpl(config, (stage, percent) => onProgress?.(percent, 100, stage));
  onTranscribeMs?.(performance.now() - transcribeStart);

  if (transcript.scope === "combined") {
    return [{ name: combinedTranscriptFileName(), blob: new Blob([cuesToVtt(cues)], { type: "text/vtt" }) }];
  }

  const windows = computeSheetWindows(sheets, config);
  return windows.map(([start, end], i) => ({
    name: gridTranscriptFileName(i),
    blob: new Blob([cuesToVtt(cuesInWindow(cues, start, end))], { type: "text/vtt" }),
  }));
}

export async function generateCollages(
  config: CollageRequest,
  options: GenerateCollagesOptions = {},
): Promise<GenerateCollagesResult> {
  const extract = options.extractFramesImpl ?? extractFramesAuto;

  // Computed up front (from the video's real dimensions) so the real extractor
  // can capture frames directly at their final cell size instead of at full
  // source resolution. Skipped when a stub extractor is injected (tests): the
  // stub doesn't use a real <video> element, and jsdom can't decode one anyway.
  let layout: GridLayout | undefined;
  if (!options.extractFramesImpl) {
    let sourceAspect = options.sourceAspect;
    if (sourceAspect === undefined || sourceAspect <= 0) {
      const metadata = await getVideoMetadata(config.videoFile);
      sourceAspect = metadata.width / metadata.height;
    }
    layout = computeOptimalGrid(config.framesPerGrid, sourceAspect, config.outputResolution, GUTTER_PX);
  }

  const extractStart = performance.now();
  const extracted = await extract(
    config,
    (done, total) => options.onProgress?.("extracting", done, total),
    layout,
    options.keyframeSampling,
  );
  const extractMs = performance.now() - extractStart;
  if (extracted.length === 0) return { sheets: [], transcriptFiles: [] };

  if (!layout) {
    const firstBitmap = extracted[0].bitmap;
    const sourceAspect = firstBitmap.width / firstBitmap.height;
    layout = computeOptimalGrid(config.framesPerGrid, sourceAspect, config.outputResolution, GUTTER_PX);
  }

  // Decided once for the whole batch (rather than per-frame) so every sheet uses a
  // consistent timestamp format instead of flipping components mid-batch.
  const lastTimestamp = extracted[extracted.length - 1].timestamp;
  const timestampFormat: TimestampFormat = {
    showHours: lastTimestamp >= 3600,
    showMinutes: lastTimestamp >= 60,
    showMilliseconds: config.targetFps > 1,
  };

  const sheets: CollageSheetInput[] = [];
  for (let start = 0; start < extracted.length; start += config.framesPerGrid) {
    const chunk = extracted.slice(start, start + config.framesPerGrid);
    sheets.push({
      bitmaps: chunk.map((f) => f.bitmap),
      timestamps: chunk.map((f) => f.timestamp),
      frameIndices: chunk.map((f) => f.frameIndex),
      layout,
      outputResolution: config.outputResolution,
      gutterPx: GUTTER_PX,
      timestampFormat,
    });
  }

  const renderStart = performance.now();
  const blobs = await renderSheetsToBlobs(sheets, config.jpegQuality, (done, total) =>
    options.onProgress?.("rendering", done, total),
  );
  const renderMs = performance.now() - renderStart;

  let transcriptFiles: TranscriptFile[] = [];
  let transcribeMs: number | undefined;
  if (options.transcript) {
    try {
      transcriptFiles = await generateTranscriptFiles(
        config,
        sheets,
        options.transcript,
        options.transcribeImpl ?? defaultTranscribeImpl,
        (done, total, stage) => options.onProgress?.("transcribing", done, total, stage),
        (ms) => (transcribeMs = ms),
      );
    } catch (err) {
      options.onWarning?.(`Transcript generation failed: ${(err as Error).message}`);
    }
  }

  options.onTiming?.({
    extractMs,
    renderMs,
    transcribeMs,
    frameCount: extracted.length,
    sheetCount: sheets.length,
  });

  return { sheets: blobs, transcriptFiles };
}
