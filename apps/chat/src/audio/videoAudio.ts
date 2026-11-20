import { createBrowserAudioPorts } from "@vid2grid/browser";
import {
  analyseAudio,
  audioTrackLines,
  Vid2GridError,
  type AudioAnalysisOptions,
  type AudioAnalysisPorts,
  type AudioAnalysisProgress,
  type AudioAnalysisRequest,
  type AudioTrack,
} from "@vid2grid/core";
import { isAbortError } from "../abort";
import type { GlobalSettings } from "../settings";
import { errorText } from "../text";
import { formatTimestamp } from "../time";
import type { AudioCoverage, AudioSpan, ChatStore, VideoAudio } from "../types";

// Shorter stretches are not worth a decode, so coverage counts them as heard.
const MIN_GAP_SECONDS = 0.5;
// Each piece is decoded on its own and saved when done, and loudness is measured against it.
export const AUDIO_PIECE_SECONDS = 300;

export interface AudioLabels {
  labels: readonly string[];
  backgroundLabels: readonly string[];
}

export function settingsLabels(
  settings: Pick<GlobalSettings, "soundLabels" | "backgroundSoundLabels">,
): AudioLabels {
  return { labels: settings.soundLabels, backgroundLabels: settings.backgroundSoundLabels };
}

export interface AudioSource {
  file: File;
  fileKey: string;
  durationSeconds: number;
}

export type AnalyseAudio = (
  file: File,
  request: AudioAnalysisRequest,
  speech: boolean,
  options: AudioAnalysisOptions,
) => Promise<AudioTrack>;

export interface AudioDeps {
  store: Pick<ChatStore, "getAudio" | "putAudio">;
  labels: AudioLabels;
  analyse?: AnalyseAudio;
  now?: () => number;
}

export interface EnsureAudioOptions {
  signal?: AbortSignal;
  onProgress?: (progress: AudioAnalysisProgress) => void;
}

// The track exists but could not be decoded; unlike a missing track, this is never saved.
export class AudioDecodeError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "AudioDecodeError";
  }
}

interface AudioJob extends AudioSpan {
  speech: boolean;
  sounds: boolean;
}

function isNoAudio(error: unknown): boolean {
  return error instanceof Vid2GridError && error.code === "no_audio";
}

function asDecodeFailure(error: unknown): unknown {
  if (isNoAudio(error) || isAbortError(error)) return error;
  return new AudioDecodeError(errorText(error), { cause: error });
}

function browserPorts(file: File, speech: boolean): AudioAnalysisPorts {
  const ports = createBrowserAudioPorts(file);
  const sounds: AudioAnalysisPorts = {
    decode: (start, end, call) =>
      ports.decode(start, end, call).catch((error: unknown) => {
        throw asDecodeFailure(error);
      }),
    scoreWindows: (windows, rate, labels, call) => ports.scoreWindows(windows, rate, labels, call),
  };
  if (!speech || !ports.transcribe) return sounds;
  const transcribe = ports.transcribe.bind(ports);
  return { ...sounds, transcribe };
}

const analyseWithBrowser: AnalyseAudio = (file, request, speech, options) =>
  analyseAudio(request, browserPorts(file, speech), options);

const running = new Map<string, Promise<unknown>>();
const remembered = new Map<string, VideoAudio>();
const listeners = new Set<(audio: VideoAudio) => void>();

function remember(audio: VideoAudio): void {
  remembered.set(audio.fileKey, audio);
  for (const listener of listeners) listener(audio);
}

// Called with every audio record loaded or saved, so a view can redraw; returns an unsubscribe.
export function onAudioChanged(listener: (audio: VideoAudio) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function loadAudio(
  store: Pick<ChatStore, "getAudio">,
  fileKey: string,
): Promise<VideoAudio | undefined> {
  const audio = await store.getAudio(fileKey);
  if (audio) remember(audio);
  return audio;
}

async function saveAudio(store: Pick<ChatStore, "putAudio">, audio: VideoAudio): Promise<void> {
  await store.putAudio(audio);
  remember(audio);
}

function emptyAudio(fileKey: string, labels: AudioLabels, now: number): VideoAudio {
  return {
    fileKey,
    labels: [...labels.labels],
    backgroundLabels: [...labels.backgroundLabels],
    speechSpans: [],
    soundSpans: [],
    speech: [],
    events: [],
    updatedAt: now,
  };
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((label, index) => label === b[index]);
}

export function hasCurrentLabels(audio: VideoAudio, labels: AudioLabels): boolean {
  return (
    sameList(audio.labels, labels.labels) &&
    sameList(audio.backgroundLabels, labels.backgroundLabels)
  );
}

// Sound events scored against other labels are dropped; speech does not depend on them.
export function withLabels(audio: VideoAudio, labels: AudioLabels): VideoAudio {
  if (hasCurrentLabels(audio, labels)) return audio;
  return {
    ...audio,
    labels: [...labels.labels],
    backgroundLabels: [...labels.backgroundLabels],
    soundSpans: [],
    events: [],
  };
}

export function mergeSpans(spans: readonly AudioSpan[]): AudioSpan[] {
  const sorted = [...spans].sort((a, b) => a.startSeconds - b.startSeconds);
  const merged: AudioSpan[] = [];
  for (const span of sorted) {
    const last = merged[merged.length - 1];
    if (last && span.startSeconds <= last.endSeconds + MIN_GAP_SECONDS) {
      last.endSeconds = Math.max(last.endSeconds, span.endSeconds);
    } else {
      merged.push({ ...span });
    }
  }
  return merged;
}

function overlapSeconds(span: AudioSpan, range: AudioSpan): number {
  const start = Math.max(span.startSeconds, range.startSeconds);
  const end = Math.min(span.endSeconds, range.endSeconds);
  return Math.max(0, end - start);
}

function uncoveredSeconds(spans: readonly AudioSpan[], range: AudioSpan): number {
  const covered = spans.reduce((sum, span) => sum + overlapSeconds(span, range), 0);
  return range.endSeconds - range.startSeconds - covered;
}

function isSpanHeard(spans: readonly AudioSpan[], range: AudioSpan): boolean {
  const length = range.endSeconds - range.startSeconds;
  if (length <= 0) {
    return spans.some(
      (span) => span.startSeconds <= range.startSeconds && range.startSeconds < span.endSeconds,
    );
  }
  return uncoveredSeconds(spans, range) < Math.min(MIN_GAP_SECONDS, length);
}

// False for a range ensureAudio could not analyse, such as one shorter than half a second.
export function isRangeHeard(audio: VideoAudio, range: AudioSpan, labels: AudioLabels): boolean {
  const current = withLabels(audio, labels);
  return isSpanHeard(current.speechSpans, range) && isSpanHeard(current.soundSpans, range);
}

function pieceCount(durationSeconds: number): number {
  const count = Math.max(1, Math.ceil(durationSeconds / AUDIO_PIECE_SECONDS));
  const lastLength = durationSeconds - (count - 1) * AUDIO_PIECE_SECONDS;
  return count > 1 && lastLength < MIN_GAP_SECONDS ? count - 1 : count;
}

// Whole pieces on a fixed grid, so every analysis of a moment measures against the same audio.
function piecesTouching(durationSeconds: number, range: AudioSpan): AudioSpan[] {
  const count = pieceCount(durationSeconds);
  const pieces: AudioSpan[] = [];
  for (let index = 0; index < count; index++) {
    const startSeconds = index * AUDIO_PIECE_SECONDS;
    const endSeconds = index === count - 1 ? durationSeconds : startSeconds + AUDIO_PIECE_SECONDS;
    const touches =
      endSeconds > range.startSeconds &&
      (startSeconds < range.endSeconds || startSeconds <= range.startSeconds);
    if (touches) pieces.push({ startSeconds, endSeconds });
  }
  return pieces;
}

function plannedJobs(audio: VideoAudio, durationSeconds: number, range: AudioSpan): AudioJob[] {
  return piecesTouching(durationSeconds, range).flatMap((piece) => {
    if (piece.endSeconds - piece.startSeconds < MIN_GAP_SECONDS) return [];
    const speech = uncoveredSeconds(audio.speechSpans, piece) >= MIN_GAP_SECONDS;
    const sounds = uncoveredSeconds(audio.soundSpans, piece) >= MIN_GAP_SECONDS;
    return speech || sounds ? [{ ...piece, speech, sounds }] : [];
  });
}

// A job replaces whatever was heard inside its piece, so a piece analysed again never doubles up.
function withTrack(audio: VideoAudio, job: AudioJob, track: AudioTrack, now: number): VideoAudio {
  const span = { startSeconds: job.startSeconds, endSeconds: job.endSeconds };
  const outside = (seconds: number) => seconds < job.startSeconds || seconds >= job.endSeconds;
  const speech = [...audio.speech.filter((cue) => outside(cue.start)), ...track.speech];
  const events = [...audio.events.filter((event) => outside(event.startSeconds)), ...track.events];
  return {
    ...audio,
    speechSpans: job.speech ? mergeSpans([...audio.speechSpans, span]) : audio.speechSpans,
    soundSpans: job.sounds ? mergeSpans([...audio.soundSpans, span]) : audio.soundSpans,
    speech: job.speech ? speech.sort((a, b) => a.start - b.start) : audio.speech,
    events: job.sounds ? events.sort((a, b) => a.startSeconds - b.startSeconds) : audio.events,
    updatedAt: now,
  };
}

function clampedRange(source: AudioSource, range: AudioSpan): AudioSpan {
  const startSeconds = Math.min(Math.max(0, range.startSeconds), source.durationSeconds);
  const endSeconds = Math.min(Math.max(startSeconds, range.endSeconds), source.durationSeconds);
  return { startSeconds, endSeconds };
}

async function analyseMissing(
  deps: AudioDeps,
  source: AudioSource,
  range: AudioSpan,
  options: EnsureAudioOptions,
): Promise<VideoAudio> {
  const now = deps.now ?? Date.now;
  const stored = await loadAudio(deps.store, source.fileKey);
  let audio = withLabels(stored ?? emptyAudio(source.fileKey, deps.labels, now()), deps.labels);
  if (audio.noAudio) return audio;
  const analyse = deps.analyse ?? analyseWithBrowser;
  const analysisOptions: AudioAnalysisOptions = {
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.onProgress ? { onProgress: options.onProgress } : {}),
  };
  for (const job of plannedJobs(audio, source.durationSeconds, clampedRange(source, range))) {
    options.signal?.throwIfAborted();
    const request: AudioAnalysisRequest = {
      labels: job.sounds ? audio.labels : [],
      backgroundLabels: audio.backgroundLabels,
      startSeconds: job.startSeconds,
      endSeconds: job.endSeconds,
    };
    try {
      const track = await analyse(source.file, request, job.speech, analysisOptions);
      audio = withTrack(audio, job, track, now());
    } catch (error) {
      if (!isNoAudio(error)) throw error;
      audio = { ...audio, noAudio: true, updatedAt: now() };
      await saveAudio(deps.store, audio);
      return audio;
    }
    await saveAudio(deps.store, audio);
  }
  return audio;
}

function abortable<T>(work: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return work;
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason as Error);
    if (signal.aborted) onAbort();
    signal.addEventListener("abort", onAbort, { once: true });
    void work.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

// One analysis runs at a time per video: a later call waits, then analyses only what is still
// missing. Rejects with AudioDecodeError when the track exists but cannot be decoded.
export function ensureAudio(
  deps: AudioDeps,
  source: AudioSource,
  range: AudioSpan,
  options: EnsureAudioOptions = {},
): Promise<VideoAudio> {
  const previous = running.get(source.fileKey) ?? Promise.resolve();
  const work = previous.then(() => {
    options.signal?.throwIfAborted();
    return analyseMissing(deps, source, range, options);
  });
  const settled = work.catch(() => undefined);
  running.set(source.fileKey, settled);
  void settled.then(() => {
    if (running.get(source.fileKey) === settled) running.delete(source.fileKey);
  });
  return abortable(work, options.signal);
}

export interface TimedAudioLine {
  startSeconds: number;
  line: string;
}

function lineOf(track: Pick<AudioTrack, "speech" | "events">): string {
  return audioTrackLines({ ...track, startSeconds: 0, durationSeconds: 0 })[0] ?? "";
}

export function timedAudioLines(
  audio: VideoAudio,
  range: AudioSpan,
  labels: AudioLabels,
): TimedAudioLine[] {
  const current = withLabels(audio, labels);
  const inRange = (start: number, end: number) =>
    start < range.endSeconds && end >= range.startSeconds;
  const speech = current.speech
    .filter((cue) => cue.text !== "" && inRange(cue.start, cue.end))
    .map((cue) => ({ startSeconds: cue.start, line: lineOf({ speech: [cue], events: [] }) }));
  const events = current.events
    .filter((event) => inRange(event.startSeconds, event.endSeconds))
    .map((event) => ({
      startSeconds: event.startSeconds,
      line: lineOf({ speech: [], events: [event] }),
    }));
  return [...speech, ...events].sort((a, b) => a.startSeconds - b.startSeconds);
}

export function audioLines(audio: VideoAudio, range: AudioSpan, labels: AudioLabels): string[] {
  return timedAudioLines(audio, range, labels).map((entry) => entry.line);
}

function spanText(spans: readonly AudioSpan[]): string {
  return spans
    .map((span) => `${formatTimestamp(span.startSeconds)} to ${formatTimestamp(span.endSeconds)}`)
    .join(", ");
}

function sameSpans(a: readonly AudioSpan[], b: readonly AudioSpan[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (span, index) =>
        span.startSeconds === b[index]?.startSeconds && span.endSeconds === b[index]?.endSeconds,
    )
  );
}

export function describeAudioCoverage(audio: VideoAudio | undefined, labels: AudioLabels): string {
  if (audio?.noAudio) return "the video has no audio track";
  const current = audio && withLabels(audio, labels);
  const speech = current?.speechSpans ?? [];
  const sounds = current?.soundSpans ?? [];
  if (speech.length === 0 && sounds.length === 0) return "not analysed yet";
  if (sameSpans(speech, sounds)) return `analysed ${spanText(speech)} (speech and sounds)`;
  const part = (name: string, spans: readonly AudioSpan[]) =>
    spans.length === 0 ? `${name} not analysed yet` : `${name} analysed ${spanText(spans)}`;
  return `${part("speech", speech)}; ${part("sounds", sounds)}`;
}

export function audioCoverage(audio: VideoAudio | undefined, labels: AudioLabels): AudioCoverage {
  return { text: describeAudioCoverage(audio, labels), canListen: audio?.noAudio !== true };
}

// Synchronous, for the token meter: reads the last record loaded or saved for this video.
export function cachedAudioCoverage(fileKey: string, labels: AudioLabels): AudioCoverage {
  return audioCoverage(remembered.get(fileKey), labels);
}

const STAGE_TEXT: Record<AudioAnalysisProgress["stage"], string> = {
  "sound-model": "Loading the sound model",
  sounds: "Listening for sounds",
  "speech-model": "Loading the speech model",
  speech: "Transcribing speech",
};

export function audioProgressText({ stage, done, total }: AudioAnalysisProgress): string {
  const share = total > 0 ? ` ${Math.round((done / total) * 100)}%` : "";
  return `${STAGE_TEXT[stage]}…${share}`;
}
