import { Vid2GridError } from "../errors";
import type { PortProgress, PortProgressCallback } from "../pipeline/ports";
import type { TranscriptCue } from "../transcript/vtt";
import type { AudioTrack } from "./audioTrack";
import { energyEnvelope } from "./loudness";
import { softmax, type WindowScores } from "./scores";
import { soundEvents, type SoundEvent } from "./soundEvents";
import { parseSoundLabel, type LabelWordings, type SoundLabel } from "./soundLabels";
import { audioWindows, type AudioWindow } from "./windows";

export const SOUND_EVENT_MIN_SCORE = 0.35;
const WINDOWS_PER_CHUNK = 16;

// Core has no DOM types, so this is the part of an AbortSignal it uses.
export interface AbortSignalLike {
  readonly aborted: boolean;
  readonly reason?: unknown;
  addEventListener(type: "abort", listener: () => void): void;
  removeEventListener(type: "abort", listener: () => void): void;
}

export interface DecodedAudio {
  samples: Float32Array;
  sampleRate: number;
}

export interface PortCallOptions {
  onProgress?: PortProgressCallback;
  signal?: AbortSignalLike;
}

export interface AudioAnalysisPorts {
  // Rejects with a "no_audio" Vid2GridError when the source has no decodable audio.
  decode(
    startSeconds: number,
    endSeconds: number,
    call?: Pick<PortCallOptions, "signal">,
  ): Promise<DecodedAudio>;
  // Raw logits per window, one per label in label order, which core turns into scores. Each
  // window owns its buffer, so a host may transfer it.
  scoreWindows(
    windows: Float32Array[],
    sampleRate: number,
    labels: readonly LabelWordings[],
    call?: PortCallOptions,
  ): Promise<number[][]>;
  transcribe?(
    samples: Float32Array,
    sampleRate: number,
    offsetSeconds: number,
    call?: PortCallOptions,
  ): Promise<TranscriptCue[]>;
}

export interface AudioAnalysisRequest {
  // Each line is parsed by parseSoundLabel.
  labels: readonly string[];
  // Scored alongside `labels` so the softmax is not forced onto one of them, but never reported.
  backgroundLabels?: readonly string[];
  minScore?: number;
  startSeconds?: number;
  endSeconds?: number;
}

export type AudioAnalysisStage = "sound-model" | "sounds" | "speech-model" | "speech";

export interface AudioAnalysisProgress {
  stage: AudioAnalysisStage;
  done: number;
  total: number;
}

export interface AudioAnalysisOptions {
  signal?: AbortSignalLike;
  onProgress?: (progress: AudioAnalysisProgress) => void;
}

// The signal's own reason is rethrown as given, so a caller sees the AbortError it expects.
function abortReason(signal: AbortSignalLike): unknown {
  return signal.reason ?? new Error("Audio analysis was aborted.");
}

function throwIfAborted(signal: AbortSignalLike | undefined): void {
  if (signal?.aborted) throw abortReason(signal);
}

// A port may not stop promptly on its own, so its call settles on abort whatever the port does.
async function untilAborted<T>(
  start: () => Promise<T>,
  signal: AbortSignalLike | undefined,
): Promise<T> {
  throwIfAborted(signal);
  if (!signal) return start();
  const work = start();
  let stopListening = (): void => {};
  const aborted = new Promise<void>((resolve) => {
    const onAbort = (): void => resolve();
    signal.addEventListener("abort", onAbort);
    stopListening = () => signal.removeEventListener("abort", onAbort);
  }).then((): never => {
    throw abortReason(signal);
  });
  try {
    return await Promise.race([work, aborted]);
  } finally {
    stopListening();
  }
}

function signalOption(options: AudioAnalysisOptions): Pick<PortCallOptions, "signal"> {
  return options.signal ? { signal: options.signal } : {};
}

function checkedLogits(logits: number[][], chunk: AudioWindow[], labelCount: number): number[][] {
  if (logits.length !== chunk.length || logits.some((row) => row.length !== labelCount)) {
    throw new Vid2GridError(
      "internal",
      `Expected ${labelCount} scores for each of ${chunk.length} windows.`,
    );
  }
  return logits;
}

function namedLabels(lines: readonly string[]): SoundLabel[] {
  return lines.map(parseSoundLabel).filter((label) => label.name !== "");
}

async function detectSoundEvents(
  audio: DecodedAudio,
  request: AudioAnalysisRequest,
  ports: AudioAnalysisPorts,
  options: AudioAnalysisOptions,
  offsetSeconds: number,
): Promise<SoundEvent[]> {
  const soundLabels = namedLabels(request.labels);
  if (soundLabels.length === 0) return [];
  const backgroundLabels = namedLabels(request.backgroundLabels ?? []);
  const labels = [...soundLabels, ...backgroundLabels];
  const wordings = labels.map((label) => label.wordings);
  const windows = audioWindows(audio.samples.length, audio.sampleRate);
  const onProgress = (progress: PortProgress): void =>
    options.onProgress?.({ stage: "sound-model", done: progress.done, total: progress.total });

  const scored: WindowScores[] = [];
  for (let first = 0; first < windows.length; first += WINDOWS_PER_CHUNK) {
    const chunk = windows.slice(first, first + WINDOWS_PER_CHUNK);
    const clips = chunk.map((window) => audio.samples.slice(window.startIndex, window.endIndex));
    const call = { onProgress, ...signalOption(options) };
    const logits = checkedLogits(
      await untilAborted(
        () => ports.scoreWindows(clips, audio.sampleRate, wordings, call),
        options.signal,
      ),
      chunk,
      labels.length,
    );
    chunk.forEach((window, index) => {
      const scores = softmax(logits[index] ?? []);
      scored.push({ startSeconds: window.startSeconds, endSeconds: window.endSeconds, scores });
    });
    options.onProgress?.({ stage: "sounds", done: scored.length, total: windows.length });
  }
  const names = labels.map((label) => label.name);
  return soundEvents(scored, names, energyEnvelope(audio.samples, audio.sampleRate), {
    minScore: request.minScore ?? SOUND_EVENT_MIN_SCORE,
    backgroundLabels: backgroundLabels.map((label) => label.name),
    offsetSeconds,
  });
}

async function transcribeSpeech(
  audio: DecodedAudio,
  ports: AudioAnalysisPorts,
  options: AudioAnalysisOptions,
  offsetSeconds: number,
): Promise<TranscriptCue[]> {
  if (!ports.transcribe) return [];
  const onProgress = (progress: PortProgress): void =>
    options.onProgress?.({
      stage: progress.stage === "model" ? "speech-model" : "speech",
      done: progress.done,
      total: progress.total,
    });
  const call = { onProgress, ...signalOption(options) };
  const transcribe = ports.transcribe.bind(ports);
  return untilAborted(
    () => transcribe(audio.samples, audio.sampleRate, offsetSeconds, call),
    options.signal,
  );
}

export async function analyseAudio(
  request: AudioAnalysisRequest,
  ports: AudioAnalysisPorts,
  options: AudioAnalysisOptions = {},
): Promise<AudioTrack> {
  const startSeconds = Math.max(0, request.startSeconds ?? 0);
  const endSeconds = request.endSeconds ?? Number.POSITIVE_INFINITY;
  const audio = await untilAborted(
    () => ports.decode(startSeconds, endSeconds, signalOption(options)),
    options.signal,
  );
  if (audio.samples.length === 0) {
    return { speech: [], events: [], startSeconds, durationSeconds: 0 };
  }

  const durationSeconds = audio.samples.length / audio.sampleRate;
  const events = await detectSoundEvents(audio, request, ports, options, startSeconds);
  // A transcriber may transfer the samples' buffer away, so it goes last.
  const speech = await transcribeSpeech(audio, ports, options, startSeconds);
  return { speech, events, startSeconds, durationSeconds };
}
