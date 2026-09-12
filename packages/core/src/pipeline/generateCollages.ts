import { validateCollagePlanRequest, type CollagePlanRequest, type VideoInfo } from "../types";
import { buildRenderPlan } from "../plan/buildRenderPlan";
import type { RenderPlan, TranscriptWindow } from "../plan/renderPlan";
import { cuesInWindow, cuesToVtt, type TranscriptCue } from "../transcript/vtt";
import type {
  ClockPort,
  CollagePorts,
  SheetRenderJob,
  TranscribeStage,
  TranscriptPort,
} from "./ports";

export type GenerationPhase = "extracting" | "rendering" | "transcribing";

export interface GenerationTimings {
  extractMs: number;
  renderMs: number;
  transcribeMs?: number;
  frameCount: number;
  sheetCount: number;
}

export interface GeneratedFile<TBinary> {
  name: string;
  data: TBinary;
}

export interface GenerateCollagesResult<TBinary> {
  plan: RenderPlan;
  sheets: GeneratedFile<TBinary>[];
  transcriptFiles: GeneratedFile<TBinary>[];
}

export interface GenerateCollagesOptions {
  onProgress?: (
    phase: GenerationPhase,
    done: number,
    total: number,
    transcribeStage?: TranscribeStage,
  ) => void;
  onTiming?: (timings: GenerationTimings) => void;
  // Non-fatal problems (a failed transcription, a video with no audio track)
  // are reported rather than thrown, so they never lose the rendered sheets.
  onWarning?: (message: string) => void;
  /** The source's already-probed duration and dimensions, to avoid probing twice. */
  videoInfo?: VideoInfo;
}

const systemClock: ClockPort = { now: () => Date.now() };

async function generateTranscriptFiles<TSource, TBinary>(
  source: TSource,
  request: CollagePlanRequest,
  windows: TranscriptWindow[],
  transcriptPort: TranscriptPort<TSource>,
  encodeText: (text: string, mimeType: string) => TBinary,
  clock: ClockPort,
  onProgress?: (done: number, total: number, stage: TranscribeStage) => void,
  onTranscribeMs?: (ms: number) => void,
): Promise<GeneratedFile<TBinary>[]> {
  const transcribeStart = clock.now();
  const cues: TranscriptCue[] = await transcriptPort.transcribe(
    source,
    request.startSeconds,
    request.endSeconds,
    (stage, percent) => onProgress?.(percent, 100, stage),
  );
  onTranscribeMs?.(clock.now() - transcribeStart);

  return windows.map((window) => ({
    name: window.fileName,
    data: encodeText(
      cuesToVtt(cuesInWindow(cues, window.startSeconds, window.endSeconds)),
      "text/vtt",
    ),
  }));
}

export async function generateCollages<TSource, TImage, TBinary>(
  source: TSource,
  request: CollagePlanRequest,
  ports: CollagePorts<TSource, TImage, TBinary>,
  options: GenerateCollagesOptions = {},
): Promise<GenerateCollagesResult<TBinary>> {
  validateCollagePlanRequest(request);
  const clock = ports.clock ?? systemClock;

  const videoInfo = options.videoInfo ?? (await ports.probe.probe(source));
  const plan = buildRenderPlan(request, videoInfo);

  const extractStart = clock.now();
  const images = await ports.frames.capture(source, plan, (done, total) =>
    options.onProgress?.("extracting", done, total),
  );
  const extractMs = clock.now() - extractStart;
  if (images.length === 0) return { plan, sheets: [], transcriptFiles: [] };

  const jobs: SheetRenderJob<TImage>[] = plan.sheets
    .filter((sheet) => sheet.cells[0].frameIndex < images.length)
    .map((sheet) => ({ sheet, images: sheet.cells.map((cell) => images[cell.frameIndex]) }));

  const renderStart = clock.now();
  const encodedSheets = await ports.sheets.encodeSheets(plan, jobs, (done, total) =>
    options.onProgress?.("rendering", done, total),
  );
  const renderMs = clock.now() - renderStart;

  let transcriptFiles: GeneratedFile<TBinary>[] = [];
  let transcribeMs: number | undefined;
  if (request.transcript) {
    try {
      const transcriptPort = ports.transcript;
      if (!transcriptPort) throw new Error("this host has no transcription support");
      const windows =
        plan.combinedTranscript !== undefined
          ? [plan.combinedTranscript]
          : jobs.flatMap((job) => (job.sheet.transcript ? [job.sheet.transcript] : []));
      transcriptFiles = await generateTranscriptFiles(
        source,
        request,
        windows,
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
    frameCount: images.length,
    sheetCount: jobs.length,
  });

  return {
    plan,
    sheets: encodedSheets.map((data, i) => ({ name: jobs[i].sheet.fileName, data })),
    transcriptFiles,
  };
}
