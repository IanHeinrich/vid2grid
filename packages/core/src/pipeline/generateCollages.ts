import { Vid2GridError } from "../errors";
import { validateCollagePlanRequest, type CollagePlanRequest } from "../plan/request";
import type { VideoInfo } from "../probe/videoInfo";
import { buildRenderPlanUnvalidated } from "../plan/buildRenderPlan";
import { resolveKeyframeSampling } from "../plan/keyframeFallback";
import type { PlannedSheet, RenderPlan } from "../plan/renderPlan";
import {
  NO_TRANSCRIPTION_PORT,
  transcriptFiles,
  transcriptionFailedWarning,
} from "../transcript/transcriptFiles";
import type { Vid2GridWarning } from "../warnings";
import type {
  ClockPort,
  CollagePorts,
  FrameCapturePort,
  Phase,
  PortProgressCallback,
  ProbePort,
  ProgressCallback,
  SheetEncoderPort,
  SheetRenderJob,
} from "./ports";

export type PhaseTimings = Partial<Record<Phase, number>>;

export interface GenerationTimings {
  // rendering sums each encode's own time, so with concurrency it is busy time, not wall time.
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

export interface StreamCollagesOptions<TBinary> extends GenerateCollagesOptions {
  // Awaited, so a slow writer holds back the encodes behind it.
  onSheet: (sheet: GeneratedFile<TBinary>) => void | Promise<void>;
}

export interface StreamCollagesResult<TBinary> {
  plan: RenderPlan;
  sheetCount: number;
  transcriptFiles: GeneratedFile<TBinary>[];
}

function errorReason(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

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
      phaseMs[phase] = (phaseMs[phase] ?? 0) + clock.now() - start;
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

interface SheetRun<TSource, TImage, TBinary> {
  source: TSource;
  plan: RenderPlan;
  info: VideoInfo;
  ports: CollagePorts<TSource, TImage, TBinary>;
  options: StreamCollagesOptions<TBinary>;
  timer: PhaseTimer;
}

interface FirstFailure {
  failed: boolean;
  error: unknown;
}

function recordFailure(failure: FirstFailure, err: unknown): void {
  if (failure.failed) return;
  failure.failed = true;
  failure.error = err;
}

function throwIfFailed(failure: FirstFailure): void {
  if (failure.failed) throw failure.error;
}

// Captured images wait here, keyed by frameIndex, until their sheet is handed to an encode.
interface SheetAssembly<TImage> {
  pending: Map<number, TImage>;
  pulled: number;
  nextSheet: number;
}

function isFullyCaptured(sheet: PlannedSheet, pulled: number): boolean {
  return sheet.cells.every((cell) => cell.frameIndex < pulled);
}

function isStarted(sheet: PlannedSheet, pulled: number): boolean {
  const first = sheet.cells[0];
  return first !== undefined && first.frameIndex < pulled;
}

function takeJob<TImage>(
  sheet: PlannedSheet,
  assembly: SheetAssembly<TImage>,
): SheetRenderJob<TImage> {
  const images = sheet.cells.map((cell) => assembly.pending.get(cell.frameIndex));
  for (const cell of sheet.cells) assembly.pending.delete(cell.frameIndex);
  assembly.nextSheet++;
  return { sheet, images };
}

function releasePending<TSource, TImage>(
  assembly: SheetAssembly<TImage>,
  frames: FrameCapturePort<TSource, TImage>,
): void {
  for (const image of assembly.pending.values()) frames.release?.(image);
  assembly.pending.clear();
}

interface SheetWriter<TImage> {
  // Resolves once fewer than the encoder's concurrency are in flight.
  slot(): Promise<void>;
  start(job: SheetRenderJob<TImage>): void;
  // Rendering progress then counts against the sheets started, not the sheets planned.
  endCapture(sheetsStillToStart: number): void;
  drain(): Promise<void>;
  written(): number;
}

function encodeConcurrency<TImage, TBinary>(sheets: SheetEncoderPort<TImage, TBinary>): number {
  const requested = sheets.concurrency ?? 1;
  return requested >= 1 ? Math.floor(requested) : 1;
}

// A sheet keeps its slot until it is delivered, so a finished sheet waiting on an earlier
// one still counts against the limit.
function sheetWriter<TSource, TImage, TBinary>(
  run: SheetRun<TSource, TImage, TBinary>,
  failure: FirstFailure,
): SheetWriter<TImage> {
  const limit = encodeConcurrency(run.ports.sheets);
  const reportRendering = progressFor(run.options, "rendering");
  const inFlight: Promise<void>[] = [];
  let lastDelivery = Promise.resolve();
  let renderTotal = run.plan.sheets.length;
  let started = 0;
  let encoded = 0;
  let written = 0;

  async function deliver(job: SheetRenderJob<TImage>, previous: Promise<void>): Promise<void> {
    try {
      const data = await run.timer.time("rendering", () => run.ports.sheets.encode(run.plan, job));
      encoded++;
      reportRendering({ done: encoded, total: renderTotal });
      await previous;
      if (failure.failed) return;
      await run.options.onSheet({ name: job.sheet.fileName, data });
      written++;
    } catch (err) {
      recordFailure(failure, err);
    }
  }

  return {
    async slot() {
      const oldest = inFlight.length >= limit ? inFlight.shift() : undefined;
      if (oldest) await oldest;
      throwIfFailed(failure);
    },
    start(job) {
      started++;
      lastDelivery = deliver(job, lastDelivery);
      inFlight.push(lastDelivery);
    },
    endCapture(sheetsStillToStart) {
      const total = started + sheetsStillToStart;
      if (total === renderTotal) return;
      renderTotal = total;
      if (total > 0 && encoded === total) reportRendering({ done: encoded, total });
    },
    async drain() {
      await Promise.all(inFlight.splice(0));
    },
    written: () => written,
  };
}

interface SheetStream<TImage> {
  frames: AsyncIterator<TImage>;
  assembly: SheetAssembly<TImage>;
  writer: SheetWriter<TImage>;
  failure: FirstFailure;
}

async function writeSheet<TImage>(sheet: PlannedSheet, stream: SheetStream<TImage>) {
  await stream.writer.slot();
  stream.writer.start(takeJob(sheet, stream.assembly));
}

async function writeCapturedSheets<TImage>(plan: RenderPlan, stream: SheetStream<TImage>) {
  const { assembly } = stream;
  let sheet = plan.sheets[assembly.nextSheet];
  while (sheet && isFullyCaptured(sheet, assembly.pulled)) {
    await writeSheet(sheet, stream);
    sheet = plan.sheets[assembly.nextSheet];
  }
}

async function pullFrames<TSource, TImage, TBinary>(
  run: SheetRun<TSource, TImage, TBinary>,
  stream: SheetStream<TImage>,
): Promise<void> {
  const reportExtracting = progressFor(run.options, "extracting");
  const { assembly } = stream;
  for (;;) {
    const next = await run.timer.time("extracting", () => stream.frames.next());
    if (next.done) {
      const { pulled } = assembly;
      if (pulled > 0 && pulled < run.plan.frames.length) {
        reportExtracting({ done: pulled, total: pulled });
      }
      return;
    }
    assembly.pending.set(assembly.pulled, next.value);
    assembly.pulled++;
    reportExtracting({ done: assembly.pulled, total: run.plan.frames.length });
    throwIfFailed(stream.failure);
    await writeCapturedSheets(run.plan, stream);
  }
}

async function finishSheets<TSource, TImage, TBinary>(
  run: SheetRun<TSource, TImage, TBinary>,
  stream: SheetStream<TImage>,
): Promise<void> {
  const partial = run.plan.sheets[stream.assembly.nextSheet];
  const startsPartial = partial !== undefined && isStarted(partial, stream.assembly.pulled);
  stream.writer.endCapture(startsPartial ? 1 : 0);
  if (partial && startsPartial) await writeSheet(partial, stream);
  releasePending(stream.assembly, run.ports.frames);
  await stream.writer.drain();
  throwIfFailed(stream.failure);
}

async function abandonSheets<TSource, TImage, TBinary>(
  run: SheetRun<TSource, TImage, TBinary>,
  stream: SheetStream<TImage>,
): Promise<void> {
  try {
    await stream.frames.return?.();
  } catch {
    // The run's first error is the one to report.
  }
  releasePending(stream.assembly, run.ports.frames);
  await stream.writer.drain();
}

interface WrittenSheets {
  frameCount: number;
  sheetCount: number;
}

async function writeSheets<TSource, TImage, TBinary>(
  run: SheetRun<TSource, TImage, TBinary>,
): Promise<WrittenSheets> {
  const failure: FirstFailure = { failed: false, error: undefined };
  const stream: SheetStream<TImage> = {
    frames: run.ports.frames.capture(run.source, run.plan, run.info)[Symbol.asyncIterator](),
    assembly: { pending: new Map(), pulled: 0, nextSheet: 0 },
    writer: sheetWriter(run, failure),
    failure,
  };
  try {
    await pullFrames(run, stream);
    await finishSheets(run, stream);
  } catch (err) {
    recordFailure(failure, err);
    await abandonSheets(run, stream);
    throw failure.error;
  }
  return { frameCount: stream.assembly.pulled, sheetCount: stream.writer.written() };
}

function transcriptionFailure(err: unknown): Vid2GridWarning {
  return transcriptionFailedWarning(
    errorReason(err),
    err instanceof Vid2GridError ? err.code : undefined,
  );
}

interface TranscriptStep<TSource, TImage, TBinary> {
  source: TSource;
  request: CollagePlanRequest;
  plan: RenderPlan;
  sheetCount: number;
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
  try {
    const cues = await step.timer.time("transcribing", () =>
      transcriptPort.transcribe(
        source,
        request.startSeconds,
        request.endSeconds,
        progressFor(options, "transcribing"),
      ),
    );
    return transcriptFiles(plan, step.sheetCount, request.endSeconds, cues).map((file) => ({
      name: file.fileName,
      data: ports.text.encodeText(file.vtt, "text/vtt"),
    }));
  } catch (err) {
    options.onWarning?.(transcriptionFailure(err));
    return [];
  }
}

export async function streamCollages<TSource, TImage, TBinary>(
  source: TSource,
  request: CollagePlanRequest,
  ports: CollagePorts<TSource, TImage, TBinary>,
  options: StreamCollagesOptions<TBinary>,
): Promise<StreamCollagesResult<TBinary>> {
  validateCollagePlanRequest(request);
  const resolved = await resolveVideoInfo(source, request, ports.probe, options.videoInfo);
  const plan = planWithKeyframeFallback(request, resolved, options.onWarning);
  const timer = phaseTimer(ports.clock);

  const { frameCount, sheetCount } = await writeSheets({
    source,
    plan,
    info: resolved.info,
    ports,
    options,
    timer,
  });
  const transcriptFiles =
    frameCount === 0
      ? []
      : await generateTranscriptFiles({ source, request, plan, sheetCount, ports, options, timer });

  options.onTiming?.({ phaseMs: timer.phaseMs, frameCount, sheetCount });
  return { plan, sheetCount, transcriptFiles };
}

export async function generateCollages<TSource, TImage, TBinary>(
  source: TSource,
  request: CollagePlanRequest,
  ports: CollagePorts<TSource, TImage, TBinary>,
  options: GenerateCollagesOptions = {},
): Promise<GenerateCollagesResult<TBinary>> {
  const sheets: GeneratedFile<TBinary>[] = [];
  const { plan, transcriptFiles } = await streamCollages(source, request, ports, {
    ...options,
    onSheet: (sheet) => {
      sheets.push(sheet);
    },
  });
  return { plan, sheets, transcriptFiles };
}
