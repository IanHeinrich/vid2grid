import { Vid2GridError } from "../errors";
import { validateCollagePlanRequest, type CollagePlanRequest } from "../plan/request";
import type { VideoInfo } from "../probe/videoInfo";
import { buildRenderPlanUnvalidated } from "../plan/buildRenderPlan";
import { resolveKeyframeSampling } from "../plan/keyframeFallback";
import type { RenderPlan, TranscriptWindow } from "../plan/renderPlan";
import { cuesInWindow, cuesToVtt } from "../transcript/vtt";
import type { Vid2GridWarning } from "../warnings";
import type {
  ClockPort,
  CollagePorts,
  Phase,
  PortProgressCallback,
  ProbePort,
  ProgressCallback,
  SheetRenderJob,
} from "./ports";

export type PhaseTimings = Partial<Record<Phase, number>>;

export interface GenerationTimings {
  phaseMs: PhaseTimings;
  frameCount: number;
  sheetCount: number;
}

export type { Vid2GridWarning, WarningCode } from "../warnings";

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
  onProgress?: ProgressCallback;
  onTiming?: (timings: GenerationTimings) => void;
  // Non-fatal problems (a failed transcription, a video with no audio track)
  // are reported rather than thrown, so they never lose the rendered sheets.
  onWarning?: (warning: Vid2GridWarning) => void;
  videoInfo?: VideoInfo;
}

const TRANSCRIPT_FAILED_PREFIX = "Transcript generation failed: ";

function errorReason(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const NO_TRANSCRIPTION_PORT: Vid2GridWarning = {
  code: "no_transcription_port",
  message: `${TRANSCRIPT_FAILED_PREFIX}this host has no transcription support`,
};

interface PhaseTimer {
  phaseMs: PhaseTimings;
  time<T>(phase: Phase, step: () => Promise<T>): Promise<T>;
}

function phaseTimer(clock: ClockPort): PhaseTimer {
  const phaseMs: PhaseTimings = {};
  return {
    phaseMs,
    async time(phase, step) {
      const start = clock.now();
      const result = await step();
      phaseMs[phase] = clock.now() - start;
      return result;
    },
  };
}

function progressFor(options: GenerateCollagesOptions, phase: Phase): PortProgressCallback {
  return (progress) => options.onProgress?.({ ...progress, phase });
}

interface ResolvedVideoInfo {
  info: VideoInfo;
  keyframeFailure?: string;
}

async function resolveVideoInfo<TSource>(
  source: TSource,
  request: CollagePlanRequest,
  probe: ProbePort<TSource>,
  supplied?: VideoInfo,
): Promise<ResolvedVideoInfo> {
  const info = supplied ?? (await probe.probe(source));
  if (request.keyframeSampling !== true || info.keyframeTimestampsSeconds !== undefined) {
    return { info };
  }
  let keyframeTimestampsSeconds: number[] | undefined;
  try {
    keyframeTimestampsSeconds = await probe.readKeyframeTimes(source);
  } catch (err) {
    return { info, keyframeFailure: errorReason(err) };
  }
  return { info: keyframeTimestampsSeconds ? { ...info, keyframeTimestampsSeconds } : info };
}

function planWithKeyframeFallback(
  request: CollagePlanRequest,
  { info, keyframeFailure }: ResolvedVideoInfo,
  onWarning?: (warning: Vid2GridWarning) => void,
): RenderPlan {
  const decision = resolveKeyframeSampling(request, info, keyframeFailure);
  if (decision.warning) onWarning?.(decision.warning);
  return buildRenderPlanUnvalidated(decision.request, info);
}

function jobsForCapturedSheets<TImage>(
  plan: RenderPlan,
  images: TImage[],
): SheetRenderJob<TImage>[] {
  return plan.sheets
    .filter((sheet) => sheet.cells[0] !== undefined && sheet.cells[0].frameIndex < images.length)
    .map((sheet) => ({ sheet, images: sheet.cells.map((cell) => images[cell.frameIndex]) }));
}

// A short capture drops the trailing sheets, so the last surviving window takes over
// their range rather than leaving the cues past it in no file at all.
function sheetWindowsForJobs<TImage>(
  jobs: SheetRenderJob<TImage>[],
  endSeconds: number,
): TranscriptWindow[] {
  const windows = jobs.flatMap((job) => (job.sheet.transcript ? [job.sheet.transcript] : []));
  const last = windows[windows.length - 1];
  if (!last) return windows;
  return [...windows.slice(0, -1), { ...last, endSeconds }];
}

function transcriptionFailure(err: unknown): Vid2GridWarning {
  const noAudio = err instanceof Vid2GridError && err.code === "no_audio";
  return {
    code: noAudio ? "no_audio" : "transcription_failed",
    message: `${TRANSCRIPT_FAILED_PREFIX}${errorReason(err)}`,
  };
}

interface TranscriptStep<TSource, TImage, TBinary> {
  source: TSource;
  request: CollagePlanRequest;
  plan: RenderPlan;
  jobs: SheetRenderJob<TImage>[];
  ports: CollagePorts<TSource, TImage, TBinary>;
  options: GenerateCollagesOptions;
  timer: PhaseTimer;
}

async function generateTranscriptFiles<TSource, TImage, TBinary>(
  step: TranscriptStep<TSource, TImage, TBinary>,
): Promise<GeneratedFile<TBinary>[]> {
  const { source, request, plan, ports, options } = step;
  if (!request.transcript) return [];
  const transcriptPort = ports.transcript;
  if (!transcriptPort) {
    options.onWarning?.(NO_TRANSCRIPTION_PORT);
    return [];
  }
  const windows =
    plan.combinedTranscript !== undefined
      ? [plan.combinedTranscript]
      : sheetWindowsForJobs(step.jobs, request.endSeconds);
  try {
    const cues = await step.timer.time("transcribing", () =>
      transcriptPort.transcribe(
        source,
        request.startSeconds,
        request.endSeconds,
        progressFor(options, "transcribing"),
      ),
    );
    return windows.map((window) => ({
      name: window.fileName,
      data: ports.text.encodeText(
        cuesToVtt(cuesInWindow(cues, window.startSeconds, window.endSeconds)),
        "text/vtt",
      ),
    }));
  } catch (err) {
    options.onWarning?.(transcriptionFailure(err));
    return [];
  }
}

export async function generateCollages<TSource, TImage, TBinary>(
  source: TSource,
  request: CollagePlanRequest,
  ports: CollagePorts<TSource, TImage, TBinary>,
  options: GenerateCollagesOptions = {},
): Promise<GenerateCollagesResult<TBinary>> {
  validateCollagePlanRequest(request);
  const resolved = await resolveVideoInfo(source, request, ports.probe, options.videoInfo);
  const plan = planWithKeyframeFallback(request, resolved, options.onWarning);
  const timer = phaseTimer(ports.clock);
  const reportTiming = (frameCount: number, sheetCount: number) =>
    options.onTiming?.({ phaseMs: timer.phaseMs, frameCount, sheetCount });

  const images = await timer.time("extracting", () =>
    ports.frames.capture(source, plan, progressFor(options, "extracting")),
  );
  if (images.length === 0) {
    reportTiming(0, 0);
    return { plan, sheets: [], transcriptFiles: [] };
  }

  const jobs = jobsForCapturedSheets(plan, images);
  const encodedSheets = await timer.time("rendering", () =>
    ports.sheets.encode(plan, jobs, progressFor(options, "rendering")),
  );
  const transcriptFiles = await generateTranscriptFiles({
    source,
    request,
    plan,
    jobs,
    ports,
    options,
    timer,
  });

  reportTiming(images.length, jobs.length);
  return {
    plan,
    sheets: encodedSheets.flatMap((data, i) => {
      const job = jobs[i];
      return job ? [{ name: job.sheet.fileName, data }] : [];
    }),
    transcriptFiles,
  };
}
