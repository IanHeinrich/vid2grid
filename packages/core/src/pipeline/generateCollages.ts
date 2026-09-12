import { validateCollageRequest, type CollageRequest, type VideoInfo } from "../types";
import { computeOptimalGrid, GUTTER_PX } from "../grid/gridMaths";
import {
  combinedTranscriptFileName,
  gridFileName,
  gridTranscriptFileName,
} from "../grid/gridFileName";
import type { CollageSheetInput } from "../render/sheetInput";
import type { TimestampFormat } from "../render/timestampFormat";
import { computeSheetWindows } from "../plan/sheetWindows";
import { cuesInWindow, cuesToVtt, type TranscriptCue } from "../transcript/vtt";
import type { ClockPort, CollagePorts, TranscribeStage, TranscriptPort } from "./ports";

export type GenerationPhase = "extracting" | "rendering" | "transcribing";

/** Lightweight per-phase timing, surfaced via `onTiming` for profiling. */
export interface GenerationTimings {
  extractMs: number;
  renderMs: number;
  transcribeMs?: number;
  frameCount: number;
  sheetCount: number;
}

/** One produced file: `data` is whatever binary the host's ports encode to. */
export interface GeneratedFile<TBinary> {
  name: string;
  data: TBinary;
}

export interface TranscriptOptions {
  /**
   * "per-sheet" pairs one .vtt with each grid sheet's frame time window;
   * "combined" produces a single whole-export transcript.vtt instead.
   */
  scope: "per-sheet" | "combined";
}

export interface GenerateCollagesResult<TBinary> {
  sheets: GeneratedFile<TBinary>[];
  transcriptFiles: GeneratedFile<TBinary>[];
}

export interface GenerateCollagesOptions {
  /**
   * `transcribeStage` is only ever populated during the "transcribing"
   * phase, distinguishing the one-time (host-cached) model download from
   * actually running it on the audio - callers can use it to show a more
   * honest label than a single generic "transcribing" message.
   */
  onProgress?: (
    phase: GenerationPhase,
    done: number,
    total: number,
    transcribeStage?: TranscribeStage,
  ) => void;
  onTiming?: (timings: GenerationTimings) => void;
  /**
   * Non-fatal problems (e.g. transcription failed or the video has no audio
   * track) are reported here rather than thrown, so a transcript failure
   * never loses the already-rendered grid images.
   */
  onWarning?: (message: string) => void;
  /**
   * The source's already-known dimensions and duration, when the caller read
   * them earlier - avoids probing again just to lay out the grid.
   */
  videoInfo?: VideoInfo;
  /**
   * Opt-in fast mode: capture only the keyframe nearest each sampled timestamp,
   * trading exact-time frames for far less decode work. Hosts that cannot do
   * this ignore it.
   */
  keyframeSampling?: boolean;
  /** Opt-in: also generate a speech-to-text transcript. */
  transcript?: TranscriptOptions;
}

const systemClock: ClockPort = { now: () => Date.now() };

async function generateTranscriptFiles<TSource, TBinary>(
  source: TSource,
  request: CollageRequest,
  sheets: { timestamps: number[] }[],
  transcript: TranscriptOptions,
  transcriptPort: TranscriptPort<TSource>,
  encodeText: (text: string, mimeType: string) => TBinary,
  clock: ClockPort,
  onProgress?: (done: number, total: number, stage: TranscribeStage) => void,
  onTranscribeMs?: (ms: number) => void,
): Promise<GeneratedFile<TBinary>[]> {
  const transcribeStart = clock.now();
  const cues: TranscriptCue[] = await transcriptPort.transcribe(
    source,
    request.startTime,
    request.endTime,
    (stage, percent) => onProgress?.(percent, 100, stage),
  );
  onTranscribeMs?.(clock.now() - transcribeStart);

  if (transcript.scope === "combined") {
    return [
      {
        name: combinedTranscriptFileName(),
        data: encodeText(cuesToVtt(cues), "text/vtt"),
      },
    ];
  }

  const windows = computeSheetWindows(sheets, request.startTime, request.endTime);
  return windows.map(([start, end], i) => ({
    name: gridTranscriptFileName(i),
    data: encodeText(cuesToVtt(cuesInWindow(cues, start, end)), "text/vtt"),
  }));
}

export async function generateCollages<TSource, TImage, TBinary>(
  source: TSource,
  request: CollageRequest,
  ports: CollagePorts<TSource, TImage, TBinary>,
  options: GenerateCollagesOptions = {},
): Promise<GenerateCollagesResult<TBinary>> {
  validateCollageRequest(request);
  const clock = ports.clock ?? systemClock;

  const videoInfo = options.videoInfo ?? (await ports.probe.probe(source));

  // Computed up front (from the video's real dimensions) so the host can
  // capture frames directly at their final cell size instead of at full source
  // resolution and downscale them again later in the render pipeline.
  const layout = computeOptimalGrid(
    request.framesPerGrid,
    videoInfo.width / videoInfo.height,
    request.outputResolution,
    GUTTER_PX,
  );

  const extractStart = clock.now();
  const captured = await ports.frames.capture(
    source,
    request,
    { width: layout.cellW, height: layout.cellH },
    options.keyframeSampling ?? false,
    (done, total) => options.onProgress?.("extracting", done, total),
  );
  const extractMs = clock.now() - extractStart;
  if (captured.length === 0) return { sheets: [], transcriptFiles: [] };

  // Decided once for the whole batch (rather than per-frame) so every sheet uses a
  // consistent timestamp format instead of flipping components mid-batch.
  const lastTimestamp = captured[captured.length - 1].timestamp;
  const timestampFormat: TimestampFormat = {
    showHours: lastTimestamp >= 3600,
    showMinutes: lastTimestamp >= 60,
    showMilliseconds: request.targetFps > 1,
  };

  const sheets: CollageSheetInput<TImage>[] = [];
  for (let start = 0; start < captured.length; start += request.framesPerGrid) {
    const chunk = captured.slice(start, start + request.framesPerGrid);
    sheets.push({
      images: chunk.map((f) => f.image),
      timestamps: chunk.map((f) => f.timestamp),
      frameIndices: chunk.map((f) => f.frameIndex),
      layout,
      outputResolution: request.outputResolution,
      gutterPx: GUTTER_PX,
      timestampFormat,
    });
  }

  const renderStart = clock.now();
  const encodedSheets = await ports.sheets.encodeSheets(
    sheets,
    request.jpegQuality,
    (done, total) => options.onProgress?.("rendering", done, total),
  );
  const renderMs = clock.now() - renderStart;

  let transcriptFiles: GeneratedFile<TBinary>[] = [];
  let transcribeMs: number | undefined;
  if (options.transcript) {
    try {
      const transcriptPort = ports.transcript;
      if (!transcriptPort) throw new Error("this host has no transcription support");
      transcriptFiles = await generateTranscriptFiles(
        source,
        request,
        sheets,
        options.transcript,
        transcriptPort,
        (text, mimeType) => ports.text.encodeText(text, mimeType),
        clock,
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
    frameCount: captured.length,
    sheetCount: sheets.length,
  });

  return {
    sheets: encodedSheets.map((data, i) => ({ name: gridFileName(i), data })),
    transcriptFiles,
  };
}
